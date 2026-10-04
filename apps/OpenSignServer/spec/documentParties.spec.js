// #86: DocumentAftersave gives every signer ACL write on the whole contracts_Document, and
// mailGuard.js lets a party mail anyone in the document's Placeholders/Signers (and the
// completion mail goes to its Bcc and SenderMail). So a signer could add recipients by
// editing the document. These specs save as the signer over REST, so the CLP, the ACL and
// the beforeSave trigger all run as they do in production.
import { makeUser, pointer, rest, uniq } from './utils/rest.js';

const FORBIDDEN = 119;

describe('a signer cannot change who a document\'s parties are', () => {
  const tag = uniq();
  let owner;
  let signer;
  let contactId;
  let otherContactId;
  let ownerExtId;
  let otherExtId;
  let docId;

  const placeholder = (email, signerObjId, response = '') => ({
    Role: 'Tenant',
    Id: 1,
    email,
    signerObjId,
    signerPtr: pointer('contracts_Contactbook', signerObjId),
    placeHolder: [{ pageNumber: 1, pos: [{ key: 1, xPosition: 10, yPosition: 10, options: { response } }] }],
  });

  const create = async (className, body) => {
    const res = await rest('POST', `/classes/${className}`, { master: true, body });
    if (res.status !== 201) throw new Error(`${className}: ${JSON.stringify(res.body)}`);
    return res.body.objectId;
  };

  const getDoc = async () => (await rest('GET', `/classes/contracts_Document/${docId}`, { master: true })).body;
  const putAs = (who, body) => rest('PUT', `/classes/contracts_Document/${docId}`, { session: who.session, body });

  beforeAll(async () => {
    owner = await makeUser(`owner-${tag}@x.test`);
    signer = await makeUser(`signer-${tag}@x.test`);
    ownerExtId = await create('contracts_Users', {
      UserId: pointer('_User', owner.id),
      UserRole: 'contracts_Admin',
      Email: owner.email,
    });
    otherExtId = await create('contracts_Users', {
      UserId: pointer('_User', `nobody${tag}`),
      UserRole: 'contracts_Admin',
      Email: `outsider-owner-${tag}@x.test`,
    });
    contactId = await create('contracts_Contactbook', {
      UserId: pointer('_User', signer.id),
      Email: signer.email,
      Name: 'Signer',
    });
    otherContactId = await create('contracts_Contactbook', {
      UserId: pointer('_User', `nobody${tag}`),
      Email: `outsider-${tag}@x.test`,
      Name: 'Outsider',
    });
    docId = await create('contracts_Document', {
      Name: `parties-${tag}`,
      URL: 'https://example.test/lease.pdf',
      CreatedBy: pointer('_User', owner.id),
      ExtUserPtr: pointer('contracts_Users', ownerExtId),
      Signers: [pointer('contracts_Contactbook', contactId)],
      Placeholders: [placeholder(signer.email, contactId)],
      ACL: {
        [owner.id]: { read: true, write: true },
        [signer.id]: { read: true, write: true },
      },
    });
  });

  afterAll(async () => {
    await rest('DELETE', `/classes/contracts_Document/${docId}`, { master: true });
  });

  it('refuses a signer adding a Placeholders recipient, and leaves the document as it was', async () => {
    const before = await getDoc();
    const res = await putAs(signer, {
      Placeholders: [placeholder(signer.email, contactId), { ...placeholder(`outsider-${tag}@x.test`, otherContactId), Role: 'Witness', Id: 2 }],
    });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    expect((await getDoc()).Placeholders).toEqual(before.Placeholders);
  });

  it('refuses a signer re-addressing an existing Placeholders entry', async () => {
    const res = await putAs(signer, { Placeholders: [placeholder(`outsider-${tag}@x.test`, contactId)] });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });

  for (const [field, value] of [
    ['Signers', () => [pointer('contracts_Contactbook', contactId), pointer('contracts_Contactbook', otherContactId)]],
    ['Bcc', () => [pointer('contracts_Contactbook', otherContactId)]],
    ['SenderMail', () => `outsider-${tag}@x.test`],
    ['ExtUserPtr', () => pointer('contracts_Users', otherExtId)],
    // Taking ownership would let a second save change everything above.
    ['CreatedBy', () => pointer('_User', signer.id)],
    // Where signing events (with the signed file's URL and signer details) are posted;
    // LeaseLynx archives the lease from them.
    ['WebhookUrl', () => `https://attacker-${tag}.example/hook`],
    // Where the next signer's browser goes after signing.
    ['RedirectUrl', () => `https://attacker-${tag}.example/phish`],
    // The file every later party sees and signs; also what getsignedurl will sign (#112).
    ['URL', () => `https://example.test/swapped-${tag}.pdf`],
    ['SignedUrl', () => `https://example.test/swapped-${tag}.pdf`],
    ['CertificateUrl', () => `https://example.test/swapped-cert-${tag}.pdf`],
  ]) {
    it(`refuses a signer changing ${field}`, async () => {
      const res = await putAs(signer, { [field]: value() });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });
  }

  // The signer really can write the document; only party changes are refused.
  it('lets a signer save a widget value and revoke, with the parties unchanged', async () => {
    let res = await putAs(signer, { Placeholders: [placeholder(signer.email, contactId, 'filled')] });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    res = await putAs(signer, { IsDeclined: true, DeclineReason: 'spec' });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    const doc = await getDoc();
    expect(doc.IsDeclined).toBeTrue();
    expect(doc.Placeholders[0].placeHolder[0].pos[0].options.response).toBe('filled');
  });

  it('lets the owner add a recipient', async () => {
    const res = await putAs(owner, {
      Placeholders: [placeholder(signer.email, contactId), { ...placeholder(`witness-${tag}@x.test`, otherContactId), Role: 'Witness', Id: 2 }],
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect((await getDoc()).Placeholders.length).toBe(2);
  });
});
