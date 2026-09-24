// spec/contactAccounts.spec.js
// Server-side _User creation after self-signup was closed: the _User beforeSave
// (rejectSelfSignup) refuses a new user without the master key, so every cloud function
// that makes an account for a contact or team member must use it. LeaseLynx creates each
// tenant as a contracts_Contactbook row without a UserId; ContactbookAftersave then makes
// the tenant's _User. Without the master key that save is refused and swallowed, and the
// tenant never gets an OpenSign account.
import fs from 'node:fs';
import path from 'node:path';
import ParseSDK from 'parse/node';
import { rejectSelfSignup } from '../cloud/parsefunction/accessGuards.js';
import { createUserAccount } from '../cloud/parsefunction/userAccount.js';
import ContactbookAftersave from '../cloud/parsefunction/ContactBookAftersave.js';
import { assertUserAdmin, callerUserRole, makeAddUser } from '../cloud/parsefunction/addUser.js';

globalThis.Parse ??= ParseSDK;

const cloudDir = path.resolve(process.cwd(), 'cloud');
const read = rel => fs.readFileSync(path.join(cloudDir, rel), 'utf8');

// A _User whose save applies the real _User beforeSave, as Parse Server would.
function fakeUserClass(created) {
  return class FakeUser {
    constructor() {
      this.attrs = {};
    }
    set(key, value) {
      this.attrs[key] = value;
    }
    get(key) {
      return this.attrs[key];
    }
    async save(_attrs, options) {
      rejectSelfSignup({ object: { isNew: () => true }, master: options?.useMasterKey === true });
      this.id = `user-${created.length + 1}`;
      created.push({ attrs: { ...this.attrs }, options });
      return this;
    }
  };
}

function fakeContact(fields) {
  const data = { ...fields };
  return {
    get: key => data[key],
    set: (key, value) => {
      data[key] = value;
    },
    getACL: () => null,
    setACL: jasmine.createSpy('setACL'),
    save: jasmine.createSpy('save').and.resolveTo({}),
  };
}

describe('server-side _User creation (self-signup closed)', () => {
  let created;
  beforeEach(() => {
    created = [];
    const FakeUser = fakeUserClass(created);
    const extend = Parse.Object.extend.bind(Parse.Object);
    spyOn(Parse.Object, 'extend').and.callFake(name => (name === 'User' ? FakeUser : extend(name)));
  });

  it('createUserAccount creates the _User with the master key', async () => {
    const user = await createUserAccount({
      name: 'Tina',
      email: 'tina@x.test',
      phone: '0800',
      password: 'pw-1',
    });
    expect(user.id).toBe('user-1');
    expect(created.length).toBe(1);
    expect(created[0].options).toEqual({ useMasterKey: true });
    expect(created[0].attrs).toEqual(
      jasmine.objectContaining({
        name: 'Tina',
        username: 'tina@x.test',
        email: 'tina@x.test',
        phone: '0800',
      })
    );
  });

  it('ContactbookAftersave gives a contact LeaseLynx created (no UserId) its _User', async () => {
    spyOn(console, 'error');
    const contact = fakeContact({ Name: 'Tina Tenant', Email: 'tina@x.test' });
    await ContactbookAftersave({ object: contact, master: true });
    expect(created.length).toBe(1);
    expect(contact.get('UserId')?.id).toBe('user-1');
    expect(contact.save).toHaveBeenCalledWith(null, { useMasterKey: true });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ContactbookAftersave logs a failed account creation instead of swallowing it', async () => {
    Parse.Object.extend.and.callFake(() => {
      throw Object.assign(new Error('storage down'), { code: 1 });
    });
    spyOn(console, 'error');
    const contact = fakeContact({ Name: 'Tina Tenant', Email: 'tina@x.test' });
    await ContactbookAftersave({ object: contact, master: true });
    expect(contact.get('UserId')).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      '[contact-user] could not create the _User for a contact',
      jasmine.objectContaining({ message: 'storage down', code: 1 })
    );
  });

  it('gives a contact a random password, never its email address', async () => {
    const contact = fakeContact({ Name: 'Tina Tenant', Email: 'tina@x.test' });
    await ContactbookAftersave({ object: contact, master: true });
    await createUserAccount({ name: 'Sam', email: 'sam@x.test' });
    const [first, second] = created.map(c => c.attrs.password);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(second).toMatch(/^[0-9a-f]{48}$/);
    expect(first).not.toBe(second);
  });

  it('no contact account is created with a chosen password', () => {
    for (const rel of [
      'parsefunction/ContactBookAftersave.js',
      'parsefunction/savecontact.js',
      'parsefunction/editContact.js',
      'parsefunction/linkContactToDoc.js',
    ]) {
      expect(read(rel)).not.toMatch(/createUserAccount\(\{[^}]*password/);
    }
  });

  it('every cloud function that creates a _User goes through createUserAccount', () => {
    for (const rel of [
      'parsefunction/ContactBookAftersave.js',
      'parsefunction/savecontact.js',
      'parsefunction/editContact.js',
      'parsefunction/linkContactToDoc.js',
      'parsefunction/addUser.js',
    ]) {
      const src = read(rel);
      expect(src).not.toMatch(/Parse\.Object\.extend\(\s*['"]_?User['"]\s*\)/);
      expect(src).toContain('createUserAccount(');
    }
  });
});

// adduser creates an account with a chosen password, and for an email that already has one
// it sets that password. Open to any signed-in user, that is a new login per call (each with
// its own daily mail limit) and a takeover of any existing account.
describe('adduser is for admins', () => {
  const FORBIDDEN = ParseSDK.Error.OPERATION_FORBIDDEN;
  const request = { user: { id: 'u1' }, params: {} };
  const roleIs = role => async () => role;

  it('refuses a signed-in user who is not an admin, before creating anything', async () => {
    const created = [];
    const extend = Parse.Object.extend.bind(Parse.Object);
    spyOn(Parse.Object, 'extend').and.callFake(name =>
      name === 'User' ? fakeUserClass(created) : extend(name)
    );
    const addUser = makeAddUser({
      authorize: req => assertUserAdmin(req, { callerRole: roleIs('contracts_User') }),
    });
    const params = {
      name: 'N',
      email: 'n@x.test',
      password: 'p',
      organization: {},
      team: 't',
      role: 'User',
      tenantId: 't1',
    };
    let err = null;
    try {
      await addUser({ ...request, params });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe(FORBIDDEN);
    expect(created).toEqual([]);
  });

  it('allows an admin and an org admin; refuses a caller with no role or no session', async () => {
    for (const role of ['contracts_Admin', 'contracts_OrgAdmin']) {
      await expectAsync(assertUserAdmin(request, { callerRole: roleIs(role) })).toBeResolved();
    }
    await expectAsync(assertUserAdmin(request, { callerRole: roleIs(undefined) })).toBeRejectedWith(
      jasmine.objectContaining({ code: FORBIDDEN })
    );
    await expectAsync(assertUserAdmin({ params: {} }, { callerRole: roleIs('contracts_Admin') })).toBeRejectedWith(
      jasmine.objectContaining({ code: ParseSDK.Error.INVALID_SESSION_TOKEN })
    );
  });

  it('reads the caller\'s role from its own contracts_Users row, with the master key', async () => {
    const calls = [];
    const query = () => {
      const q = {
        equalTo: (key, value) => {
          calls.push([key, value]);
          return q;
        },
        first: async options => {
          calls.push(['first', options]);
          return { get: key => (key === 'UserRole' ? 'contracts_Admin' : undefined) };
        },
      };
      return q;
    };
    expect(await callerUserRole({ id: 'u1' }, { query })).toBe('contracts_Admin');
    expect(calls).toEqual([
      ['UserId', { __type: 'Pointer', className: '_User', objectId: 'u1' }],
      ['first', { useMasterKey: true }],
    ]);
    const none = () => ({ equalTo: () => none(), first: async () => undefined });
    expect(await callerUserRole({ id: 'u9' }, { query: none })).toBeUndefined();
  });
});
