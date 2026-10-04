// TemplateAfterSave gives every template signer ACL write on the whole contracts_Template,
// and its CLP is update: '*'. So a signer could take the template over (CreatedBy),
// swap its file or rewrite its recipients. Only its owner or the master key may write
// it now (re-review item 2 on PR #6). Over REST with real sessions, production CLPs.
import { makeUser, pointer, rest, uniq } from './utils/rest.js';

const FORBIDDEN = 119;

describe('only a template\'s owner (or the master key) writes it', () => {
  const tag = uniq();
  let owner;
  let signer;
  let templateId;
  const ids = [];

  const create = async body => {
    const res = await rest('POST', '/classes/contracts_Template', { master: true, body });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    ids.push(res.body.objectId);
    return res.body.objectId;
  };
  const get = async (id = templateId) => (await rest('GET', `/classes/contracts_Template/${id}`, { master: true })).body;
  const putAs = (who, body, id = templateId) =>
    rest('PUT', `/classes/contracts_Template/${id}`, { session: who?.session, master: who === 'master', body });

  beforeAll(async () => {
    owner = await makeUser(`tpl-owner-${tag}@x.test`);
    signer = await makeUser(`tpl-signer-${tag}@x.test`);
    templateId = await create({
      Name: `tpl-${tag}`,
      URL: 'https://example.test/template.pdf',
      CreatedBy: pointer('_User', owner.id),
      Placeholders: [{ Role: 'Tenant', Id: 1, email: signer.email, placeHolder: [] }],
      // As TemplateAfterSave sets it: the owner and each signer can write.
      ACL: { [owner.id]: { read: true, write: true }, [signer.id]: { read: true, write: true } },
    });
  });

  afterAll(async () => {
    for (const id of ids) await rest('DELETE', `/classes/contracts_Template/${id}`, { master: true });
  });

  for (const [field, value] of [
    ['CreatedBy', () => pointer('_User', signer.id)],
    ['URL', () => `https://example.test/swapped-${tag}.pdf`],
    ['Placeholders', () => [{ Role: 'Tenant', Id: 1, email: `outsider-${tag}@x.test`, placeHolder: [] }]],
    ['SharedWith', () => [pointer('contracts_Teams', `team${tag}`)]],
    ['Name', () => 'Renamed by signer'],
    ['ACL', () => ({ '*': { read: true, write: true } })],
  ]) {
    it(`refuses a template signer changing ${field}`, async () => {
      const before = await get();
      const res = await putAs(signer, { [field]: value() });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
      expect((await get())[field]).toEqual(before[field]);
    });
  }

  it('lets the owner edit and share its template, but not hand it away', async () => {
    let res = await putAs(owner, { Name: 'Owner renamed', SharedWith: [] });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    res = await putAs(owner, { CreatedBy: pointer('_User', signer.id) });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });

  it('lets the master key change it (createduplicate, saveastemplate)', async () => {
    const res = await putAs('master', { URL: `https://example.test/master-${tag}.pdf` });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
  });

  it('keeps a template with no CreatedBy master-only', async () => {
    const orphan = await create({ Name: 'orphan', ACL: { [signer.id]: { read: true, write: true } } });
    const res = await putAs(signer, { Name: 'Claimed' }, orphan);
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });

  it('still refuses a client creating a template in someone else\'s name', async () => {
    const res = await rest('POST', '/classes/contracts_Template', {
      session: signer.session,
      body: { Name: 'planted', CreatedBy: pointer('_User', owner.id) },
    });
    if (res.body?.objectId) ids.push(res.body.objectId);
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });
});
