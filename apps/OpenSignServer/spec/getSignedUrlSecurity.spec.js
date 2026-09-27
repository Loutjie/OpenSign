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
const foreignUrl = `https://storage.googleapis.com/${bucket}/another-landlord-contract.pdf`;

describe('getsignedurl document boundary', () => {
  let prior;
  let priorParse;

  beforeEach(() => {
    priorParse = globalThis.Parse;
    globalThis.Parse = { Error: ParseError };
    prior = Object.fromEntries(
      ['USE_LOCAL', 'SERVER_URL', 'DO_SPACE', 'DO_ENDPOINT', 'DO_REGION', 'DO_ACCESS_KEY_ID', 'DO_SECRET_ACCESS_KEY']
        .map(key => [key, process.env[key]])
    );
    Object.assign(process.env, {
      USE_LOCAL: 'false',
      SERVER_URL: 'https://signing-api.leaselynx.co.za/app',
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
});
