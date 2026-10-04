// getsignedurl with a docId or templateId, called over REST as the client calls it
// (#112, #86 review): the record is looked up first in every storage mode, only a file
// it references is signed, a template needs a session that can read it, and an
// IsEnableOTP document needs a party's session. A document without OTP stays readable by
// whoever holds its link: LeaseLynx signers have no session (it never sets IsEnableOTP).
import { makeUser, pointer, rest, uniq } from './utils/rest.js';

const BUCKET = 'leaselynx-opensign-files';
const ENDPOINT = 'https://storage.googleapis.com';
const S3_ENV = {
  USE_LOCAL: 'false',
  DO_SPACE: BUCKET,
  DO_ENDPOINT: ENDPOINT,
  DO_REGION: 'us-central1',
  DO_ACCESS_KEY_ID: 'GOOGTESTKEY',
  DO_SECRET_ACCESS_KEY: 'testsecret',
  MASTER_KEY: 'spec-master-key',
};
const FORBIDDEN = 119;
const NOT_FOUND = 101;
const NO_SESSION = 209;

describe('getsignedurl for a named document or template', () => {
  const tag = uniq();
  const key = name => `${'a'.repeat(32)}_${name}-${tag}.pdf`;
  const bucketUrl = name => `${ENDPOINT}/${BUCKET}/${key(name)}`;
  let owner;
  let signer;
  let outsider;
  let savedEnv;
  const ids = {};

  const create = async (className, body) => {
    const res = await rest('POST', `/classes/${className}`, { master: true, body });
    if (res.status !== 201) throw new Error(`${className}: ${JSON.stringify(res.body)}`);
    return res.body.objectId;
  };
  const sign = (params, who) => rest('POST', '/functions/getsignedurl', { session: who?.session, body: params });
  const signedOk = res => {
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect(new URL(res.body.result).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  };
  const acl = (...users) => Object.fromEntries(users.map(u => [u.id, { read: true, write: true }]));

  beforeAll(async () => {
    owner = await makeUser(`gsu-owner-${tag}@x.test`);
    signer = await makeUser(`gsu-signer-${tag}@x.test`);
    outsider = await makeUser(`gsu-outsider-${tag}@x.test`);
    const widget = { pageNumber: 1, pos: [{ key: 1, options: { response: bucketUrl('widget') } }] };
    const base = {
      URL: bucketUrl('lease'),
      CreatedBy: pointer('_User', owner.id),
      Placeholders: [{ Role: 'Tenant', Id: 1, email: signer.email, placeHolder: [widget] }],
    };
    ids.linkDoc = await create('contracts_Document', { ...base, Name: 'link', ACL: acl(owner, signer) });
    ids.otpDoc = await create('contracts_Document', { ...base, Name: 'otp', IsEnableOTP: true, ACL: acl(owner, signer) });
    ids.template = await create('contracts_Template', { ...base, Name: 'tpl', ACL: acl(owner) });
    ids.localDoc = await create('contracts_Document', {
      Name: 'local',
      URL: `${process.env.SERVER_URL}/files/test/${key('local')}`,
      CreatedBy: pointer('_User', owner.id),
      ACL: acl(owner),
    });
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(S3_ENV).map(k => [k, process.env[k]]));
    Object.assign(process.env, S3_ENV);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterAll(async () => {
    for (const id of [ids.linkDoc, ids.otpDoc, ids.localDoc]) {
      await rest('DELETE', `/classes/contracts_Document/${id}`, { master: true });
    }
    await rest('DELETE', `/classes/contracts_Template/${ids.template}`, { master: true });
  });

  describe('a document without OTP (the LeaseLynx case: the link is the credential)', () => {
    it('signs its file and its widget images for a holder with no session', async () => {
      signedOk(await sign({ url: bucketUrl('lease'), docId: ids.linkDoc }));
      signedOk(await sign({ url: bucketUrl('widget'), docId: ids.linkDoc }));
    });

    it('refuses a key it does not reference, such as a guessed signed_<doc>_<n>.pdf', async () => {
      // Real keys are <32 hex>_signed_..., never guessable (spec/fileUpload.spec.js).
      const guessed = `${ENDPOINT}/${BUCKET}/signed_lease_${tag}_1.pdf`;
      const res = await sign({ url: guessed, docId: ids.linkDoc });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });

    it('404s an unknown docId', async () => {
      const res = await sign({ url: bucketUrl('lease'), docId: `missing${tag}` });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(NOT_FOUND);
    });
  });

  describe('a document with IsEnableOTP', () => {
    it('refuses a caller with no session', async () => {
      const res = await sign({ url: bucketUrl('lease'), docId: ids.otpDoc });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(NO_SESSION);
    });

    it('refuses a signed-in user who is not a party', async () => {
      const res = await sign({ url: bucketUrl('lease'), docId: ids.otpDoc }, outsider);
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });

    it('signs for its signer and its owner', async () => {
      signedOk(await sign({ url: bucketUrl('lease'), docId: ids.otpDoc }, signer));
      signedOk(await sign({ url: bucketUrl('widget'), docId: ids.otpDoc }, owner));
    });
  });

  describe('a template', () => {
    it('refuses a caller with no session', async () => {
      const res = await sign({ url: bucketUrl('lease'), templateId: ids.template });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(NO_SESSION);
    });

    it('refuses a signed-in user who cannot read it', async () => {
      const res = await sign({ url: bucketUrl('lease'), templateId: ids.template }, outsider);
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });

    it('signs for its owner', async () => {
      signedOk(await sign({ url: bucketUrl('lease'), templateId: ids.template }, owner));
    });
  });

  describe('local storage mode (fails closed too)', () => {
    beforeEach(() => {
      process.env.USE_LOCAL = 'true';
    });
    const localUrl = name => `${process.env.SERVER_URL}/files/test/${key(name)}`;

    it('mints no token for an unknown document', async () => {
      const res = await sign({ url: localUrl('local'), docId: `missing${tag}` });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(NOT_FOUND);
    });

    it('mints no token for a file the document does not reference', async () => {
      const res = await sign({ url: localUrl('someone-elses'), docId: ids.localDoc });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });

    it('mints a token for the document\'s own file', async () => {
      const res = await sign({ url: localUrl('local'), docId: ids.localDoc });
      expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
      expect(res.body.result).toContain(`${key('local')}?token=`);
    });
  });
});
