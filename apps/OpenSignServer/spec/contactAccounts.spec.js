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
