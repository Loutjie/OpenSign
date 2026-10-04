import { getSignedUrl } from '../cloud/parsefunction/getSignedUrl.js';

class ParseError extends Error {
  static INVALID_SESSION_TOKEN = 209;
  static OPERATION_FORBIDDEN = 119;

  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const bucket = 'leaselynx-opensign-files';
const serverUrl = 'https://signing-api.leaselynx.co.za/app';
const foreignUrl = `https://storage.googleapis.com/${bucket}/another-landlord-contract.pdf`;
// The same kind of file under local storage: a Parse /files/ URL on this server.
const foreignLocalUrl = `${serverUrl}/files/test/0a1b2c_another-landlord-contract.pdf`;

async function failureOf(request) {
  try {
    const result = await getSignedUrl(request);
    return { result };
  } catch (error) {
    return error;
  }
}

describe('getsignedurl document boundary', () => {
  let prior;
  let priorParse;

  beforeEach(() => {
    priorParse = globalThis.Parse;
    globalThis.Parse = { Error: ParseError };
    prior = Object.fromEntries(
      [
        'USE_LOCAL',
        'SERVER_URL',
        'MASTER_KEY',
        'DO_SPACE',
        'DO_ENDPOINT',
        'DO_REGION',
        'DO_ACCESS_KEY_ID',
        'DO_SECRET_ACCESS_KEY',
      ].map(key => [key, process.env[key]])
    );
    Object.assign(process.env, {
      USE_LOCAL: 'false',
      SERVER_URL: serverUrl,
      // Lets local mode actually mint a token, so a refusal is the branch refusing and
      // not jwt.sign failing for want of a secret.
      MASTER_KEY: 'spec-master-key',
      DO_SPACE: bucket,
      DO_ENDPOINT: 'https://storage.googleapis.com',
      DO_REGION: 'us-central1',
      DO_ACCESS_KEY_ID: 'GOOGTESTKEY',
      DO_SECRET_ACCESS_KEY: 'testsecret',
    });
  });

  afterEach(() => {
    if (priorParse === undefined) delete globalThis.Parse;
    else globalThis.Parse = priorParse;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects an authenticated session without a document before signing a foreign key', async () => {
    let failure;
    try {
      await getSignedUrl({ params: { url: foreignUrl }, user: { id: 'landlord-b' } });
    } catch (error) {
      failure = error;
    }
    expect(failure?.code).toBe(ParseError.OPERATION_FORBIDDEN);
  });

  // #112: no client path calls getsignedurl without a docId or templateId, so a
  // session alone authorises no file in either storage mode, not even one the caller
  // uploaded.
  it('local storage: refuses to mint a token for another landlord\'s file without a document', async () => {
    process.env.USE_LOCAL = 'true';
    const outcome = await failureOf({ params: { url: foreignLocalUrl }, user: { id: 'landlord-b' } });
    expect(outcome.result).toBeUndefined();
    expect(outcome.code).toBe(ParseError.OPERATION_FORBIDDEN);
  });

  it('local storage: refuses the caller\'s own file without a document too', async () => {
    process.env.USE_LOCAL = 'true';
    const ownUrl = `${serverUrl}/files/test/9f8e7d_my-own-upload.png`;
    const outcome = await failureOf({ params: { url: ownUrl }, user: { id: 'landlord-b' } });
    expect(outcome.result).toBeUndefined();
    expect(outcome.code).toBe(ParseError.OPERATION_FORBIDDEN);
  });

  for (const [mode, useLocal, url] of [
    ['S3', 'false', foreignUrl],
    ['local', 'true', foreignLocalUrl],
  ]) {
    it(`${mode} storage: refuses an unauthenticated caller without a document`, async () => {
      process.env.USE_LOCAL = useLocal;
      const outcome = await failureOf({ params: { url } });
      expect(outcome.result).toBeUndefined();
      expect(outcome.code).toBe(ParseError.INVALID_SESSION_TOKEN);
    });
  }
});
