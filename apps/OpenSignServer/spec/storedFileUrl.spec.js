// spec/storedFileUrl.spec.js
// Our bucket is named leaselynx-opensign-files, so the old `url.includes('files')`
// test sent every GCS URL down the local-file branch and nothing was ever signed.
import {
  isLocalParseFileUrl,
  isBucketUrl,
  objectKeyFromUrl,
} from '../cloud/parsefunction/storedFileUrl.js';
import getPresignedUrl, {
  documentFileKeys,
  bucketConfigError,
} from '../cloud/parsefunction/getSignedUrl.js';
import { spawnSync } from 'node:child_process';
import sendMailWithAttachment from '../cloud/parsefunction/sendMailWithAttachment.js';
import fs from 'node:fs';

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
  it('is false for another host with the same path', () => {
    expect(
      isLocalParseFileUrl('https://evil.example/app/files/opensign/x.pdf', SERVER)
    ).toBeFalse();
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
  it('refuses another bucket virtual-hosted, and a host that only starts like the endpoint', () => {
    expect(
      isBucketUrl('https://other-bucket.storage.googleapis.com/x.pdf', BUCKET, ENDPOINT)
    ).toBeFalse();
    expect(
      isBucketUrl('https://evil-storage.googleapis.com.example/x', BUCKET, ENDPOINT)
    ).toBeFalse();
    expect(
      isBucketUrl(`https://${BUCKET}.storage.googleapis.com.example/x`, BUCKET, ENDPOINT)
    ).toBeFalse();
    expect(
      isBucketUrl(`https://storage.googleapis.com.example/${BUCKET}/x`, BUCKET, ENDPOINT)
    ).toBeFalse();
  });
});

describe('bucketConfigError (S3-mode startup check)', () => {
  const env = over => ({
    DO_BASEURL: `${ENDPOINT}/${BUCKET}`,
    DO_SPACE: BUCKET,
    DO_ENDPOINT: ENDPOINT,
    ...over,
  });
  it('accepts a base URL in the bucket, path-style or virtual-hosted, endpoint with or without scheme', () => {
    expect(bucketConfigError(env())).toBeNull();
    expect(
      bucketConfigError(env({ DO_BASEURL: `https://${BUCKET}.storage.googleapis.com` }))
    ).toBeNull();
    expect(bucketConfigError(env({ DO_ENDPOINT: 'storage.googleapis.com' }))).toBeNull();
  });
  it('refuses a base URL in another bucket, on another host, or missing values', () => {
    for (const over of [
      { DO_BASEURL: `${ENDPOINT}/other-bucket` },
      { DO_BASEURL: `https://cdn.example/${BUCKET}` },
      { DO_SPACE: 'other-bucket' },
      { DO_ENDPOINT: 'https://nyc3.digitaloceanspaces.com' },
      { DO_BASEURL: undefined },
      { DO_SPACE: undefined },
    ]) {
      expect(bucketConfigError(env(over)))
        .withContext(JSON.stringify(over))
        .toContain('DO_BASEURL');
    }
  });
  it('makes the server exit non-zero at startup in S3 mode', () => {
    // Runs index.js outside the TESTING harness; the check exits before anything starts.
    const run = spawnSync(process.execPath, ['index.js'], {
      env: {
        ...process.env,
        TESTING: '',
        USE_LOCAL: 'false',
        ...env({ DO_BASEURL: `${ENDPOINT}/other-bucket` }),
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('FATAL: DO_BASEURL');
  });
});

// In local mode, the /files/ token check applies to file routes only, not to class names
// that contain "files".
describe('local-mode file token check', () => {
  it('does not refuse a class whose name contains "Files"', async () => {
    const res = await fetch('http://localhost:30001/test/classes/partners_DataFiles', {
      headers: { 'X-Parse-Application-Id': 'test', 'X-Parse-Master-Key': 'test' },
    });
    expect(res.status).toBe(200);
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

    it("signs a template's own file and refuses a foreign key (templateId)", async () => {
      const Template = Parse.Object.extend('contracts_Template');
      const template = await new Template().save(
        { URL: PATH_URL, Name: 'spec template' },
        { useMasterKey: true }
      );
      const own = await Parse.Cloud.run('getsignedurl', { url: PATH_URL, templateId: template.id });
      expect(new URL(own).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      await expectAsync(
        Parse.Cloud.run('getsignedurl', {
          url: `${ENDPOINT}/${BUCKET}/someone_elses.pdf`,
          templateId: template.id,
        })
      ).toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN }));
    });
  });

  describe('sendMailWithAttachment with its default signer', () => {
    it('downloads a bucket document through a fresh signature', async () => {
      const requested = [];
      const download = async (url, filePath) => {
        requested.push(url);
        fs.writeFileSync(filePath, Buffer.from('%PDF-1.4 synthetic'));
        return { ok: true };
      };
      const sent = [];
      const res = await sendMailWithAttachment(
        {
          documentId: 'doc1',
          recipient: 'a@x.test',
          subject: 'Signed',
          url: `${PATH_URL}?X-Amz-Signature=stale`,
          certificatePath: '/nonexistent/cert.pdf',
        },
        { relay: async m => sent.push(m), download }
      );
      expect(res).toEqual({ status: 'success' });
      expect(requested.length).toBe(1);
      const url = new URL(requested[0]);
      expect(decodeURIComponent(url.pathname)).toBe(`/${BUCKET}/${KEY}`);
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(sent[0].attachments.length).toBe(1);
    });
  });

  describe('afterFind signs by the storage mode at call time', () => {
    // The spec server starts with USE_LOCAL=true (spec .env), so an afterFind that read
    // the mode at import would take the local branch here and sign nothing.
    it("signs a document's bucket files and prefill image; passes a legacy local URL through", async () => {
      const bucketUrl = key => `${ENDPOINT}/${BUCKET}/${key}`;
      const legacy = `${SERVER}/files/opensign/legacy_prefill.png`;
      const Doc = Parse.Object.extend('contracts_Document');
      const saved = await new Doc().save(
        {
          Name: 'afterFind spec',
          URL: bucketUrl('lease.pdf'),
          SignedUrl: bucketUrl('signed_lease.pdf'),
          CertificateUrl: bucketUrl('cert_lease.pdf'),
          Placeholders: [
            {
              Role: 'prefill',
              Id: 'p1',
              placeHolder: [
                {
                  pageNumber: 1,
                  pos: [
                    { key: 1, type: 'image', options: { response: bucketUrl('prefill.png') } },
                    { key: 2, type: 'draw', options: { response: legacy } },
                  ],
                },
              ],
            },
          ],
        },
        { useMasterKey: true }
      );
      const doc = await new Parse.Query('contracts_Document').get(saved.id, {
        useMasterKey: true,
      });
      const signature = url => new URL(url).searchParams.get('X-Amz-Signature');
      for (const field of ['URL', 'SignedUrl', 'CertificateUrl']) {
        expect(signature(doc.get(field)))
          .withContext(field)
          .toMatch(/^[0-9a-f]{64}$/);
      }
      const [image, drawing] = doc.get('Placeholders')[0].placeHolder[0].pos;
      expect(signature(image.options.response)).toMatch(/^[0-9a-f]{64}$/);
      expect(drawing.options.response).toBe(legacy);
      expect(drawing.options.response).not.toContain('token=');
      await saved.destroy({ useMasterKey: true });

      // A legacy local URL in a top-level field takes the hook's own resolver.
      const older = await new Doc().save(
        { Name: 'legacy spec', URL: bucketUrl('old.pdf'), CertificateUrl: legacy },
        { useMasterKey: true }
      );
      const first = await new Parse.Query('contracts_Document')
        .equalTo('objectId', older.id)
        .first({ useMasterKey: true });
      expect(signature(first.get('URL'))).toMatch(/^[0-9a-f]{64}$/);
      expect(first.get('CertificateUrl')).toBe(legacy);
      await older.destroy({ useMasterKey: true });
    });
  });

  describe('no JWT for bucket-backed files (S3 mode)', () => {
    // With the S3 adapter, Parse's /files route would serve any object through the
    // server's own HMAC identity; a JWT for it bypasses the private bucket.
    const forbidden = jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN });

    it('fileupload and getsignedurl refuse to mint a local-file token when useLocal !== "true"', async () => {
      const local = `${SERVER}/files/opensign/${KEY}`;
      await expectAsync(Parse.Cloud.run('fileupload', { url: local })).toBeRejectedWith(forbidden);
      await expectAsync(
        Parse.Cloud.run('getsignedurl', { url: local, docId: 'x' })
      ).toBeRejectedWith(forbidden);
    });

    it('fileupload returns a bucket URL unchanged, with no token (a stale client sends them)', async () => {
      expect(await Parse.Cloud.run('fileupload', { url: PATH_URL })).toEqual({ url: PATH_URL });
    });

    it('getPresignedUrl passes a legacy local Parse URL through unchanged in S3 mode, minting nothing', async () => {
      // afterFind hooks sign every stored URL; one legacy value must not fail the lookup.
      const local = `${SERVER}/files/opensign/${KEY}`;
      const out = await getPresignedUrl(local);
      expect(out).toBe(local);
      expect(out).not.toContain('token=');
    });

    it('the /files/ route refuses a read in any letter case in S3 mode', async () => {
      // Express and Parse's FilesRouter match routes case-insensitively, so /Files/
      // reaches the same handler. A real stored file makes a bypass visible as a 200.
      process.env.USE_LOCAL = 'true';
      const file = await new Parse.File('case.pdf', [37, 80, 68, 70]).save({ useMasterKey: true });
      process.env.USE_LOCAL = 'false';
      try {
        for (const segment of ['files', 'Files', 'FILES']) {
          const route = `http://localhost:30001/test/${segment}/test/${file.name()}`;
          for (const method of ['GET', 'HEAD']) {
            expect((await fetch(`${route}?token=anything`, { method })).status)
              .withContext(`${method} ${segment}`)
              .toBe(403);
          }
        }
        // Local mode keeps its token check in any letter case too.
        process.env.USE_LOCAL = 'true';
        const upper = `http://localhost:30001/test/Files/test/${file.name()}`;
        expect((await fetch(upper)).status).toBe(400);
      } finally {
        process.env.USE_LOCAL = 'true';
        await file.destroy({ useMasterKey: true });
      }
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
