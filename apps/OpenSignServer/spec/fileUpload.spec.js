// POST /files/<name> as clients and cloud code make it, against index.js's config. The
// key is always <32 hex>_<name> (FilesController, top-level preserveFileName false): a
// client cannot choose a stored key, so it cannot overwrite one, and server-made keys
// such as <hex>_signed_<doc>.pdf and <hex>_certificate.pdf cannot be guessed.
import { makeUser, rest, uniq } from './utils/rest.js';

const PDF = Buffer.from('%PDF-1.4\n% spec\n');
const RANDOM_PREFIX = /^[0-9a-f]{32}_/;

describe('file uploads', () => {
  const tag = uniq();
  let user;

  const upload = (name, opts) =>
    rest('POST', `/files/${encodeURIComponent(name)}`, { raw: PDF, contentType: 'application/pdf', ...opts });

  beforeAll(async () => {
    user = await makeUser(`uploader-${tag}@x.test`);
  });

  it('stores a signed-in upload under a random-prefixed key', async () => {
    const res = await upload(`lease-${tag}.pdf`, { session: user.session });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(201);
    expect(res.body.name).toMatch(RANDOM_PREFIX);
    expect(res.body.name.endsWith(`_lease-${tag}.pdf`)).toBeTrue();
  });

  it('gives an upload named after an existing key a new key, so it cannot overwrite it', async () => {
    const first = await upload(`victim-${tag}.pdf`, { session: user.session });
    const existingKey = first.body.name;
    const second = await upload(existingKey, { session: user.session });
    expect(second.status).withContext(JSON.stringify(second.body)).toBe(201);
    expect(second.body.name).not.toBe(existingKey);
    expect(second.body.name).toBe(`${second.body.name.slice(0, 33)}${existingKey}`);
    expect(second.body.name).toMatch(RANDOM_PREFIX);
  });

  it('prefixes a master-key upload too (signPdf, certificates)', async () => {
    const res = await upload(`signed_lease_${tag}.pdf`, { master: true });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(201);
    expect(res.body.name).toMatch(RANDOM_PREFIX);
  });

  it('refuses an upload with no session', async () => {
    const res = await upload(`anon-${tag}.pdf`);
    expect(res.status).withContext(JSON.stringify(res.body)).not.toBe(201);
    expect(res.body?.code).toBe(130);
  });
});
