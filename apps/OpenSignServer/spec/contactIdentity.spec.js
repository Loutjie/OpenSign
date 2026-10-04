// mailGuard.js trusts a document's Signers[].Email (contracts_Contactbook rows), and
// ContactBookAftersave gives the contact's own user ACL write on its row. So a signer
// could re-address its contact and then mail any address as a "signer" through
// sendmailv3/forwarddoc. Saved over REST with real sessions.
import { makeUser, pointer, rest, uniq } from './utils/rest.js';

const FORBIDDEN = 119;

describe('a contact\'s identity is its owner\'s to change', () => {
  const tag = uniq();
  let owner;
  let signer;
  let contactId;

  const put = (who, body) => rest('PUT', `/classes/contracts_Contactbook/${contactId}`, { session: who.session, body });
  const get = async () => (await rest('GET', `/classes/contracts_Contactbook/${contactId}`, { master: true })).body;

  beforeAll(async () => {
    owner = await makeUser(`cb-owner-${tag}@x.test`);
    signer = await makeUser(`cb-signer-${tag}@x.test`);
    const res = await rest('POST', '/classes/contracts_Contactbook', {
      master: true,
      body: {
        Name: 'Signer',
        Email: signer.email,
        UserId: pointer('_User', signer.id),
        CreatedBy: pointer('_User', owner.id),
        ACL: { [owner.id]: { read: true, write: true }, [signer.id]: { read: true, write: true } },
      },
    });
    contactId = res.body.objectId;
  });

  afterAll(async () => {
    await rest('DELETE', `/classes/contracts_Contactbook/${contactId}`, { master: true });
  });

  for (const [field, value] of [
    ['Email', () => `outsider-${tag}@x.test`],
    ['UserId', () => pointer('_User', owner.id)],
    ['CreatedBy', () => pointer('_User', signer.id)],
    ['ExtUserPtr', () => pointer('contracts_Users', `someExt${tag}`)],
    ['IsDeleted', () => true],
    ['ACL', () => ({ '*': { read: true, write: true } })],
  ]) {
    it(`refuses the contact's own user changing ${field}`, async () => {
      const before = await get();
      const res = await put(signer, { [field]: value() });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
      expect((await get())[field]).toEqual(before[field]);
    });
  }

  it('still lets the contact\'s user save its tour status', async () => {
    const res = await put(signer, { TourStatus: [{ requestSign: true }] });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
  });

  it('lets the owner correct the contact\'s email', async () => {
    const res = await put(owner, { Email: `corrected-${tag}@x.test` });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect((await get()).Email).toBe(`corrected-${tag}@x.test`);
  });

  // No client creates contacts directly (savecontact, linkcontacttodoc, createbatchcontact
  // and editcontact use the master key). A direct create made ContactBookAftersave create
  // a _User for any email, and its response carried that user's password.
  it('refuses a client creating a contact, in its own name, another\'s, or with no session', async () => {
    const body = who => ({ Name: 'Planted', Email: `planted-${tag}@x.test`, CreatedBy: pointer('_User', who) });
    for (const [label, opts] of [
      ['own name', { session: signer.session, body: body(signer.id) }],
      ['owner\'s name', { session: signer.session, body: body(owner.id) }],
      ['no session', { body: body(owner.id) }],
    ]) {
      const res = await rest('POST', '/classes/contracts_Contactbook', opts);
      expect(res.body?.code).withContext(`${label}: ${JSON.stringify(res.body)}`).toBe(FORBIDDEN);
    }
    const users = await rest('GET', `/users?where=${encodeURIComponent(JSON.stringify({ email: `planted-${tag}@x.test` }))}`, { master: true });
    expect(users.body.results).toEqual([]);
  });
});
