// spec/storedFileUrl.spec.js
// Our bucket is named leaselynx-opensign-files, so the old `url.includes('files')`
// test sent every GCS URL down the local-file branch and nothing was ever signed.
import {
  isLocalParseFileUrl,
  isBucketUrl,
  objectKeyFromUrl,
} from '../cloud/parsefunction/storedFileUrl.js';
import getPresignedUrl, { documentFileKeys } from '../cloud/parsefunction/getSignedUrl.js';

const SERVER = 'https://signing-api.leaselynx.co.za/app';
const BUCKET = 'leaselynx-opensign-files';
const ENDPOINT = 'https://storage.googleapis.com';
const KEY = 'c1a827bec10ab7baf3a156849d6487da_Lease_Tenant.pdf';
const PATH_URL = `${ENDPOINT}/${BUCKET}/${KEY}`;

describe('isLocalParseFileUrl', () => {
  it('is true only for Parse file URLs under the server mount', () => {
    expect(isLocalParseFileUrl(`${SERVER}/files/opensign/${KEY}`, SERVER)).toBeTrue();
    expect(isLocalParseFileUrl(`${SERVER}/files/opensign/${KEY}?token=abc`, SERVER)).toBeTrue();
    expect(
      isLocalParseFileUrl(
        `http://localhost:8080/app/files/opensign/${KEY}`,
        'http://localhost:8080/app'
      )
    ).toBeTrue();
  });
  it('is false for any GCS URL, even with a bucket named *-files', () => {
    for (const url of [
      PATH_URL,
      `https://${BUCKET}.storage.googleapis.com/${KEY}`,
      `${PATH_URL}?X-Amz-Signature=abc`,
    ]) {
      expect(isLocalParseFileUrl(url, SERVER)).withContext(url).toBeFalse();
    }
  });
  it('is false for other server paths and malformed input', () => {
    expect(isLocalParseFileUrl(`${SERVER}/functions/getsignedurl`, SERVER)).toBeFalse();
    expect(isLocalParseFileUrl('not a url', SERVER)).toBeFalse();
    expect(isLocalParseFileUrl('', SERVER)).toBeFalse();
  });
});

describe('isBucketUrl', () => {
  it('accepts path-style and virtual-hosted URLs of our bucket only', () => {
    expect(isBucketUrl(PATH_URL, BUCKET, ENDPOINT)).toBeTrue();
    expect(
      isBucketUrl(`https://${BUCKET}.storage.googleapis.com/${KEY}`, BUCKET, ENDPOINT)
    ).toBeTrue();
    expect(isBucketUrl(`${ENDPOINT}/other-bucket/${KEY}`, BUCKET, ENDPOINT)).toBeFalse();
    expect(isBucketUrl('data:image/png;base64,AAAA', BUCKET, ENDPOINT)).toBeFalse();
    expect(isBucketUrl(`https://images.example.com/${KEY}`, BUCKET, ENDPOINT)).toBeFalse();
  });
});

describe('objectKeyFromUrl', () => {
  it('reads the key from path-style, virtual-hosted and signed URLs, percent-decoded', () => {
    expect(objectKeyFromUrl(PATH_URL)).toBe(KEY);
    expect(objectKeyFromUrl(`https://${BUCKET}.storage.googleapis.com/${KEY}`)).toBe(KEY);
    expect(objectKeyFromUrl(`${PATH_URL}?X-Amz-Signature=abc`)).toBe(KEY);
    expect(objectKeyFromUrl(`${ENDPOINT}/${BUCKET}/a_Lease%20Tenant.pdf`)).toBe(
      'a_Lease Tenant.pdf'
    );
  });
});

// Env for every block below; restored key by key (never replace process.env itself).
// Scoped to this describe: a top-level beforeEach would run before every spec in the
// whole jasmine run (it overrode mailFailures.spec.js's MASTER_KEY).
const TEST_ENV = {
  SERVER_URL: SERVER,
  DO_SPACE: BUCKET,
  DO_ENDPOINT: ENDPOINT,
  DO_REGION: 'us-central1',
  DO_ACCESS_KEY_ID: 'GOOGTESTKEY',
  DO_SECRET_ACCESS_KEY: 'testsecret',
  MASTER_KEY: 'mk',
  USE_LOCAL: 'false',
};
describe('stored file signing (S3-mode env)', () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(TEST_ENV).map(k => [k, process.env[k]]));
    Object.assign(process.env, TEST_ENV);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('getPresignedUrl', () => {
    it('signs our bucket path-style, on the endpoint host, with no checksum parameter, for 900 s', async () => {
      const signed = new URL(await getPresignedUrl(`${PATH_URL}?X-Amz-Signature=stale`));
      expect(signed.host).toBe('storage.googleapis.com');
      expect(decodeURIComponent(signed.pathname)).toBe(`/${BUCKET}/${KEY}`);
      expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(signed.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(signed.searchParams.has('x-amz-checksum-mode')).toBeFalse();
    });

    it('keeps a key with a space signable', async () => {
      const signed = new URL(await getPresignedUrl(`${ENDPOINT}/${BUCKET}/a_Lease%20Tenant.pdf`));
      expect(decodeURIComponent(signed.pathname)).toBe(`/${BUCKET}/a_Lease Tenant.pdf`);
    });

    it('gives a local Parse file a JWT in local mode and leaves foreign URLs untouched', async () => {
      // A local-file token is a local-storage (USE_LOCAL=true) feature only; in S3 mode
      // it is refused (see 'no JWT for bucket-backed files' below).
      process.env.USE_LOCAL = 'true';
      const local = await getPresignedUrl(`${SERVER}/files/opensign/${KEY}`);
      expect(local).toContain('?token=');
      process.env.USE_LOCAL = 'false';
      const dataUrl = 'data:image/png;base64,AAAA';
      expect(await getPresignedUrl(dataUrl)).toBe(dataUrl);
      expect(await getPresignedUrl('https://images.example.com/x.png')).toBe(
        'https://images.example.com/x.png'
      );
    });
  });

  describe('documentFileKeys', () => {
    it('collects the keys of every file a document references, across all roles', () => {
      const keys = documentFileKeys({
        URL: PATH_URL,
        SignedUrl: `${ENDPOINT}/${BUCKET}/signed_x.pdf?X-Amz-Signature=a`,
        CertificateUrl: `${ENDPOINT}/${BUCKET}/cert_x.pdf`,
        Placeholders: [
          {
            Role: 'prefill',
            placeHolder: [
              { pos: [{ options: { response: `${ENDPOINT}/${BUCKET}/prefill.png` } }] },
            ],
          },
          {
            Role: 'Tenant',
            placeHolder: [
              { pos: [{ options: { defaultValue: `${ENDPOINT}/${BUCKET}/default.png` } }] },
            ],
          },
        ],
      });
      expect([...keys].sort()).toEqual(
        [KEY, 'cert_x.pdf', 'default.png', 'prefill.png', 'signed_x.pdf'].sort()
      );
    });

    it('skips values that are not URLs of our bucket', () => {
      const keys = documentFileKeys({
        URL: `${ENDPOINT}/other-bucket/foreign.pdf`,
        Placeholders: [
          {
            Role: 'Tenant',
            placeHolder: [
              {
                pos: [
                  {
                    options: { response: 'data:image/png;base64,AAAA', defaultValue: 'plain text' },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect([...keys]).toEqual([]);
    });
  });

  describe('getsignedurl cloud function (wired ownership check)', () => {
    // Uses the Parse server helper.js starts. Save a contracts_Document whose URL is
    // PATH_URL, then call the function the way the client does.
    it("signs the document's own file, refuses a foreign key, and 404s an unknown docId", async () => {
      const Doc = Parse.Object.extend('contracts_Document');
      const doc = await new Doc().save({ URL: PATH_URL, Name: 'spec' }, { useMasterKey: true });
      const own = await Parse.Cloud.run('getsignedurl', { url: PATH_URL, docId: doc.id });
      expect(new URL(own).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      await expectAsync(
        Parse.Cloud.run('getsignedurl', {
          url: `${ENDPOINT}/${BUCKET}/someone_elses.pdf`,
          docId: doc.id,
        })
      ).toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN }));
      await expectAsync(
        Parse.Cloud.run('getsignedurl', { url: PATH_URL, docId: 'doesNotExist' })
      ).toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OBJECT_NOT_FOUND }));
    });
  });

  describe('no JWT for bucket-backed files (S3 mode)', () => {
    // With the S3 adapter, Parse's /files route would serve any object through the
    // server's own HMAC identity; a JWT for it bypasses the private bucket.
    it('fileupload and getsignedurl refuse to mint a local-file token when useLocal !== "true"', async () => {
      const local = `${SERVER}/files/opensign/${KEY}`;
      await expectAsync(Parse.Cloud.run('fileupload', { url: local })).toBeRejected();
      await expectAsync(Parse.Cloud.run('getsignedurl', { url: local, docId: 'x' })).toBeRejected();
    });

    it('getPresignedUrl refuses a local Parse file in S3 mode', async () => {
      await expectAsync(getPresignedUrl(`${SERVER}/files/opensign/${KEY}`)).toBeRejectedWith(
        jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN })
      );
    });

    it('the /files/ route answers 403 to a read in S3 mode, and keeps token checks in local mode', async () => {
      // helper.js serves the app on :30001 with the Parse mount at /test.
      const fileRoute = `http://localhost:30001/test/files/test/${KEY}`;
      for (const method of ['GET', 'HEAD']) {
        expect((await fetch(`${fileRoute}?token=anything`, { method })).status)
          .withContext(method)
          .toBe(403);
      }
      process.env.USE_LOCAL = 'true';
      expect((await fetch(fileRoute)).status).toBe(400);
    });
  });
});
