// spec/rotateContactPasswords.spec.js
// The one-off rotation of contact accounts whose password is still their email address
// (scripts/rotateContactPasswords.js). Runs against a fake Parse: which accounts are
// checked, rotated or skipped, and that a dry run writes nothing.
import {
  classifyUser,
  makeRateLimiter,
  makeVerifyPassword,
  parseArgs,
  rotateContactPasswords,
} from '../scripts/rotateContactPasswords.js';

const pointer = id => ({ id, className: '_User' });

// An in-memory Parse with just what the script uses: Query over a class, filtered and
// paged for real (equalTo, greaterThan, ascending('objectId'), limit), and rows that save.
function fakeParse(tables) {
  const saves = [];
  class Row {
    constructor(fields) {
      this.fields = fields;
    }
    get id() {
      return this.fields.objectId;
    }
    get(key) {
      return this.fields[key];
    }
    set(key, value) {
      this.fields[key] = value;
    }
    async save(_attrs, options) {
      saves.push({ id: this.id, fields: { ...this.fields }, options });
      return this;
    }
  }
  class Query {
    constructor(className) {
      this.rows = tables[className] || [];
      this.tests = [];
      this.max = 100;
      this.queries = (tables.queries ||= []);
      this.queries.push(this);
    }
    equalTo(key, value) {
      this.tests.push(r => r[key] === value);
      return this;
    }
    greaterThan(key, value) {
      this.tests.push(r => r[key] > value);
      return this;
    }
    ascending(key) {
      this.sortKey = key;
      return this;
    }
    limit(n) {
      this.max = n;
      return this;
    }
    async find(options) {
      this.options = options;
      const rows = this.rows.filter(r => this.tests.every(t => t(r)));
      if (this.sortKey) rows.sort((a, b) => (a[this.sortKey] < b[this.sortKey] ? -1 : 1));
      return rows.slice(0, this.max).map(r => new Row(r));
    }
  }
  return { Parse: { Query }, saves, tables };
}

// A server whose accounts have the given passwords. Records each check.
function fakeVerifier(passwords, { failFor = [] } = {}) {
  const calls = [];
  const verify = async (username, password) => {
    calls.push(username);
    if (failFor.includes(username)) throw new Error('verifyPassword HTTP 503');
    return passwords[username] === password;
  };
  return { verify, calls };
}

const noWait = async () => {};

function world() {
  const users = [
    { objectId: 'u1', username: 'tenant@x.test', email: 'tenant@x.test' }, // contact, password = email
    { objectId: 'u2', username: 'landlord@x.test', email: 'landlord@x.test' }, // LeaseLynx landlord, random password
    { objectId: 'u3', username: 'admin-by-userid@x.test', email: 'admin-by-userid@x.test' },
    { objectId: 'u4', username: 'admin-by-userptr@x.test', email: 'admin-by-userptr@x.test' },
    { objectId: 'u5', username: 'autologin@x.test', email: 'autologin@x.test' }, // --exclude
    { objectId: 'u6', username: 'no-email' }, // no email to compare with
    { objectId: 'u7', username: 'plain-user@x.test', email: 'plain-user@x.test' }, // contracts_Users, not admin
  ];
  const contractsUsers = [
    { objectId: 'c1', UserRole: 'contracts_Admin', UserId: pointer('u3') },
    { objectId: 'c2', UserRole: 'contracts_Admin', UserPtr: pointer('u4') },
    { objectId: 'c3', UserRole: 'contracts_User', UserId: pointer('u7') },
  ];
  // Admins and the excluded account also have password = email: they must still be left alone.
  const passwords = {
    'tenant@x.test': 'tenant@x.test',
    'landlord@x.test': 'long-random-secret',
    'admin-by-userid@x.test': 'admin-by-userid@x.test',
    'admin-by-userptr@x.test': 'admin-by-userptr@x.test',
    'autologin@x.test': 'autologin@x.test',
    'plain-user@x.test': 'plain-user@x.test',
  };
  return { fake: fakeParse({ _User: users, contracts_Users: contractsUsers }), passwords };
}

describe('rotateContactPasswords', () => {
  it('with --apply, rotates only accounts whose password is their email, and skips admins and --exclude', async () => {
    const { fake, passwords } = world();
    const { verify, calls } = fakeVerifier(passwords);
    const counts = await rotateContactPasswords({
      Parse: fake.Parse,
      verifyPassword: verify,
      apply: true,
      exclude: [' AutoLogin@X.test '],
      limiter: noWait,
    });

    expect(counts).toEqual({ checked: 3, matched: 2, rotated: 2, skipped: 4, errors: 0 });
    // Admins, the excluded account and the email-less one are never even tried.
    expect(calls.sort()).toEqual(['landlord@x.test', 'plain-user@x.test', 'tenant@x.test']);
    expect(fake.saves.map(s => s.id).sort()).toEqual(['u1', 'u7']);
    for (const save of fake.saves) {
      expect(save.options).toEqual({ useMasterKey: true });
      expect(save.fields.password).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes
      expect(save.fields.password).not.toBe(save.fields.email);
    }
    expect(fake.saves[0].fields.password).not.toBe(fake.saves[1].fields.password);
    // Every read used the master key.
    expect(fake.tables.queries.every(q => q.options?.useMasterKey === true)).toBeTrue();
  });

  it('by default (dry run) counts the same accounts and writes nothing', async () => {
    const { fake, passwords } = world();
    const { verify } = fakeVerifier(passwords);
    const counts = await rotateContactPasswords({
      Parse: fake.Parse,
      verifyPassword: verify,
      exclude: ['autologin@x.test'],
      limiter: noWait,
    });
    expect(counts).toEqual({ checked: 3, matched: 2, rotated: 0, skipped: 4, errors: 0 });
    expect(fake.saves).toEqual([]);
  });

  it('pages through every _User, past the page size', async () => {
    const users = Array.from({ length: 250 }, (_, i) => {
      const email = `t${i}@x.test`;
      return { objectId: `u${String(i).padStart(4, '0')}`, username: email, email };
    });
    const fake = fakeParse({ _User: users, contracts_Users: [] });
    const { verify, calls } = fakeVerifier(Object.fromEntries(users.map(u => [u.username, u.email])));
    const counts = await rotateContactPasswords({ Parse: fake.Parse, verifyPassword: verify, limiter: noWait });
    expect(counts.checked).toBe(250);
    expect(counts.matched).toBe(250);
    expect(new Set(calls).size).toBe(250);
  });

  it('counts a failed check as an error, not a match, and carries on', async () => {
    const { fake, passwords } = world();
    const { verify } = fakeVerifier(passwords, { failFor: ['tenant@x.test'] });
    const counts = await rotateContactPasswords({
      Parse: fake.Parse,
      verifyPassword: verify,
      apply: true,
      exclude: ['autologin@x.test'],
      limiter: noWait,
    });
    expect(counts).toEqual({ checked: 3, matched: 1, rotated: 1, skipped: 4, errors: 1 });
    expect(fake.saves.map(s => s.id)).toEqual(['u7']);
  });

  it('waits on the rate limiter before every check and every write', async () => {
    const { fake, passwords } = world();
    const { verify } = fakeVerifier(passwords);
    let waits = 0;
    await rotateContactPasswords({
      Parse: fake.Parse,
      verifyPassword: verify,
      apply: true,
      exclude: ['autologin@x.test'],
      limiter: async () => {
        waits += 1;
      },
    });
    expect(waits).toBe(3 + 2); // three checks, two rotations
  });
});

describe('classifyUser', () => {
  const user = fields => ({ id: fields.objectId, get: key => fields[key] });
  const ctx = { adminIds: new Set(['a1']), exclude: new Set(['skip@x.test']) };
  it('skips an admin', () => expect(classifyUser(user({ objectId: 'a1', username: 'a@x.test', email: 'a@x.test' }), ctx)).toBe('admin'));
  it('skips an excluded username, whatever its case', () =>
    expect(classifyUser(user({ objectId: 'x', username: 'Skip@X.test', email: 'skip@x.test' }), ctx)).toBe('excluded'));
  it('skips an account without an email', () => expect(classifyUser(user({ objectId: 'x', username: 'x' }), ctx)).toBe('no-email'));
  it('checks everyone else', () =>
    expect(classifyUser(user({ objectId: 'x', username: 'c@x.test', email: 'c@x.test' }), ctx)).toBe('check'));
});

describe('makeRateLimiter', () => {
  it('lets through at most 5 a second', async () => {
    let clock = 0;
    const limiter = makeRateLimiter(5, { now: () => clock, sleep: async ms => { clock += ms; } });
    for (let i = 0; i < 11; i += 1) await limiter();
    expect(clock).toBe(2000); // the 11th starts two seconds after the 1st
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run', () => expect(parseArgs([])).toEqual({ apply: false, exclude: [] }));
  it('writes only with --apply, and takes --exclude more than once', () =>
    expect(parseArgs(['--exclude', 'a@x.test', '--apply', '--exclude=b@x.test'])).toEqual({
      apply: true,
      exclude: ['a@x.test', 'b@x.test'],
    }));
  it('refuses an unknown flag or an --exclude without a value', () => {
    expect(() => parseArgs(['--aply'])).toThrowError(/Unknown argument/);
    expect(() => parseArgs(['--exclude'])).toThrowError(/--exclude needs/);
  });
});

describe('makeVerifyPassword', () => {
  const answer = (status, body) => async (url, init) => {
    answer.last = { url, init };
    return { ok: status === 200, status, json: async () => body };
  };
  const make = fetchImpl => makeVerifyPassword({ serverUrl: 'https://sign.test/app/', appId: 'opensign', fetchImpl });

  it('POSTs to /verifyPassword, keeping the password out of the URL, and opens no session', async () => {
    expect(await make(answer(200, { objectId: 'u1' }))('t@x.test', 't@x.test')).toBeTrue();
    expect(answer.last.url).toBe('https://sign.test/app/verifyPassword');
    expect(answer.last.init.method).toBe('POST');
    expect(answer.last.init.headers['X-Parse-Application-Id']).toBe('opensign');
    expect(answer.last.init.headers['X-Parse-Master-Key']).toBeUndefined();
    expect(JSON.parse(answer.last.init.body)).toEqual({ username: 't@x.test', password: 't@x.test' });
  });
  it('reads "Invalid username/password" (101) as no match', async () => {
    expect(await make(answer(404, { code: 101, error: 'Invalid username/password.' }))('t@x.test', 't@x.test')).toBeFalse();
  });
  it('throws on anything else, without the password in the message', async () => {
    const err = await make(answer(503, {}))('t@x.test', 'secret-guess').catch(e => e);
    expect(err.message).toContain('503');
    expect(err.message).not.toContain('secret-guess');
  });
});
