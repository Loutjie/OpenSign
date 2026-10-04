// #86: DocumentAftersave gives every signer ACL write on the whole contracts_Document, and
// mailGuard.js lets a party mail anyone in the document's Placeholders/Signers (and the
// completion mail goes to its Bcc and SenderMail). So a signer could add recipients, swap
// the file, repoint the webhook or rewrite the record. These specs save over REST as real
// sessions, so the CLP, the ACL and the beforeSave trigger all run as in production.
import { makeUser, pointer, rest, uniq } from './utils/rest.js';

const FORBIDDEN = 119;

describe('only a document\'s owner (or the master key) writes it', () => {
  const tag = uniq();
  let owner;
  let signer;
  let contactId;
  let otherContactId;
  let ownerExtId;
  let otherExtId;
  let signerExtId;
  let docId;
  const docs = [];

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
    if (className === 'contracts_Document') docs.push(res.body.objectId);
    return res.body.objectId;
  };

  const getDoc = async (id = docId) => (await rest('GET', `/classes/contracts_Document/${id}`, { master: true })).body;
  const putAs = (who, body, id = docId) =>
    rest('PUT', `/classes/contracts_Document/${id}`, { session: who?.session, master: who === 'master', body });

  const docBody = extra => ({
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
    ...extra,
  });

  beforeAll(async () => {
    owner = await makeUser(`owner-${tag}@x.test`);
    signer = await makeUser(`signer-${tag}@x.test`);
    ownerExtId = await create('contracts_Users', {
      UserId: pointer('_User', owner.id),
      UserRole: 'contracts_Admin',
      Email: owner.email,
    });
    signerExtId = await create('contracts_Users', {
      UserId: pointer('_User', signer.id),
      UserRole: 'contracts_User',
      Email: signer.email,
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
    docId = await create('contracts_Document', docBody());
  });

  afterAll(async () => {
    for (const id of docs) await rest('DELETE', `/classes/contracts_Document/${id}`, { master: true });
  });

  describe('a signer (ACL write, not the owner)', () => {
    it('cannot add a Placeholders recipient, and the document stays as it was', async () => {
      const before = await getDoc();
      const res = await putAs(signer, {
        Placeholders: [placeholder(signer.email, contactId), { ...placeholder(`outsider-${tag}@x.test`, otherContactId), Role: 'Witness', Id: 2 }],
      });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
      expect((await getDoc()).Placeholders).toEqual(before.Placeholders);
    });

    for (const [label, entry] of [
      ['re-address an entry', () => placeholder(`outsider-${tag}@x.test`, contactId)],
      ['repoint an entry\'s signerObjId', () => ({ ...placeholder(signer.email, contactId), signerObjId: otherContactId })],
      ['repoint an entry\'s signerPtr', () => ({ ...placeholder(signer.email, contactId), signerPtr: pointer('contracts_Contactbook', otherContactId) })],
      // Widget values are saved by signPdf with the master key, never by the client.
      ['fill in a widget value itself', () => placeholder(signer.email, contactId, 'filled')],
    ]) {
      it(`cannot ${label}`, async () => {
        const res = await putAs(signer, { Placeholders: [entry()] });
        expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
      });
    }

    for (const [field, value] of [
      ['Signers', () => [pointer('contracts_Contactbook', contactId), pointer('contracts_Contactbook', otherContactId)]],
      ['Bcc', () => [pointer('contracts_Contactbook', otherContactId)]],
      ['SenderMail', () => `outsider-${tag}@x.test`],
      ['SenderName', () => 'Not The Landlord'],
      ['ExtUserPtr', () => pointer('contracts_Users', otherExtId)],
      ['CreatedBy', () => pointer('_User', signer.id)],
      ['WebhookUrl', () => `https://attacker-${tag}.example/hook`],
      ['RedirectUrl', () => `https://attacker-${tag}.example/phish`],
      ['URL', () => `https://example.test/swapped-${tag}.pdf`],
      ['SignedUrl', () => `https://example.test/swapped-${tag}.pdf`],
      ['CertificateUrl', () => `https://example.test/swapped-cert-${tag}.pdf`],
      ['IsEnableOTP', () => true],
      ['IsCompleted', () => true],
      ['IsDeclined', () => true],
      ['AuditTrail', () => [{ UserPtr: pointer('contracts_Contactbook', contactId), Activity: 'Signed' }]],
      ['Name', () => 'Renamed'],
      ['ACL', () => ({ '*': { read: true, write: true } })],
    ]) {
      it(`cannot change ${field}`, async () => {
        const before = await getDoc();
        const res = await putAs(signer, { [field]: value() });
        expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
        expect((await getDoc())[field]).toEqual(before[field]);
      });
    }
  });

  // The paths signers actually use (signPdf, declinedoc, linkcontacttodoc, triggerevent)
  // and LeaseLynx write with the master key.
  it('the master key can still change parties, widget values, files and the audit trail', async () => {
    const res = await putAs('master', {
      Placeholders: [placeholder(signer.email, contactId, 'signed-by-signPdf')],
      SignedUrl: `https://example.test/signed-${tag}.pdf`,
      AuditTrail: [{ UserPtr: pointer('contracts_Contactbook', contactId), Activity: 'Signed' }],
      Signers: [pointer('contracts_Contactbook', contactId), pointer('contracts_Contactbook', otherContactId)],
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    const doc = await getDoc();
    expect(doc.Placeholders[0].placeHolder[0].pos[0].options.response).toBe('signed-by-signPdf');
    expect(doc.Signers.length).toBe(2);
  });

  it('the owner can add a recipient and change its own document', async () => {
    const res = await putAs(owner, {
      Placeholders: [placeholder(signer.email, contactId), { ...placeholder(`witness-${tag}@x.test`, otherContactId), Role: 'Witness', Id: 2 }],
      Name: 'Owner renamed',
      ExpiryDate: { __type: 'Date', iso: '2030-01-01T00:00:00.000Z' },
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect((await getDoc()).Placeholders.length).toBe(2);
  });

  it('the owner cannot hand the document to someone else', async () => {
    let res = await putAs(owner, { CreatedBy: pointer('_User', signer.id) });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    res = await putAs(owner, { ExtUserPtr: pointer('contracts_Users', otherExtId) });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });

  it('nobody but the master key writes a document with no CreatedBy', async () => {
    const orphan = await create('contracts_Document', { ...docBody(), CreatedBy: undefined });
    const res = await putAs(signer, { Name: 'Claimed' }, orphan);
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    expect((await putAs('master', { Name: 'Fixed' }, orphan)).status).toBe(200);
  });

  describe('creating a document', () => {
    const createAs = (who, body) => rest('POST', '/classes/contracts_Document', { session: who?.session, body });

    it('refuses a document in someone else\'s name, with another user\'s ExtUserPtr, or with no session', async () => {
      for (const [label, who, body] of [
        ['CreatedBy another user', signer, docBody({ CreatedBy: pointer('_User', owner.id), ExtUserPtr: pointer('contracts_Users', signerExtId) })],
        ['another user\'s ExtUserPtr', signer, docBody({ CreatedBy: pointer('_User', signer.id), ExtUserPtr: pointer('contracts_Users', ownerExtId) })],
        ['no CreatedBy', signer, docBody({ CreatedBy: undefined, ExtUserPtr: undefined })],
        ['no session', null, docBody()],
      ]) {
        const res = await createAs(who, body);
        if (res.body?.objectId) docs.push(res.body.objectId);
        expect(res.body?.code).withContext(`${label}: ${JSON.stringify(res.body)}`).toBe(FORBIDDEN);
      }
    });

    it('lets a user create a document in its own name', async () => {
      const res = await createAs(signer, docBody({
        CreatedBy: pointer('_User', signer.id),
        ExtUserPtr: pointer('contracts_Users', signerExtId),
        ACL: { [signer.id]: { read: true, write: true } },
      }));
      if (res.body?.objectId) docs.push(res.body.objectId);
      expect(res.status).withContext(JSON.stringify(res.body)).toBe(201);
    });
  });
});
