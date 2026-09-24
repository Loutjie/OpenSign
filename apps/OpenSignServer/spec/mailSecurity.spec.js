// spec/mailSecurity.spec.js
// Group A of the relay fix wave: no self-signup, sendmailv3/forwarddoc limited to a
// document's parties, a daily recipient limit, and an OTP attempt limit.
import ParseSDK from 'parse/node';
import { FakeTable } from './utils/fakeQuery.js';
import {
  rejectSelfSignup,
  requireMasterKey,
  registerAccessGuards,
  MASTER_ONLY_CLASSES,
} from '../cloud/parsefunction/accessGuards.js';
import { makeUsersignup, saveUser } from '../cloud/parsefunction/usersignup.js';
import { makeAddAdmin } from '../cloud/parsefunction/AddAdmin.js';
import {
  assertDocumentMailAllowed,
  authorizeDocumentMail,
  loadMailDocument,
  makeMailQuota,
  parseMailCounter,
  recipientList,
} from '../cloud/parsefunction/mailGuard.js';
import { makeSendmailv3, userForSessionToken } from '../cloud/parsefunction/sendMailv3.js';
import { makeForwardDoc } from '../cloud/parsefunction/ForwardDoc.js';
import {
  makeAuthLoginAsMail,
  parseOtpStore,
  MAX_OTP_ATTEMPTS,
  OTP_LOCK_MS,
} from '../cloud/parsefunction/AuthLoginAsMail.js';

globalThis.Parse ??= ParseSDK;
const FORBIDDEN = ParseSDK.Error.OPERATION_FORBIDDEN;

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

// ─── A1: self-signup ───────────────────────────────────────────────────────

describe('A1 no self-signup', () => {
  const newUser = { isNew: () => true };
  const existingUser = { isNew: () => false };

  it('refuses a new _User without the master key', () => {
    expect(() => rejectSelfSignup({ object: newUser, master: false })).toThrowMatching(e => e.code === FORBIDDEN);
  });
  it('allows a new _User with the master key, and any update of an existing one', () => {
    expect(() => rejectSelfSignup({ object: newUser, master: true })).not.toThrow();
    expect(() => rejectSelfSignup({ object: existingUser, master: false })).not.toThrow();
  });
  it('requireMasterKey refuses everyone but the master key', () => {
    expect(() => requireMasterKey({ master: false })).toThrowMatching(e => e.code === FORBIDDEN);
    expect(() => requireMasterKey({ master: true })).not.toThrow();
  });
  it('registers the _User guard and master-only find/save/delete for OTP and mail-limit classes', () => {
    const calls = [];
    const rec = kind => (target, fn) => calls.push({ kind, target, fn });
    registerAccessGuards({ beforeSave: rec('beforeSave'), beforeFind: rec('beforeFind'), beforeDelete: rec('beforeDelete') });
    expect(calls).toContain({ kind: 'beforeSave', target: Parse.User, fn: rejectSelfSignup });
    expect(MASTER_ONLY_CLASSES).toEqual(['defaultdata_Otp', 'MailRateLimit']);
    for (const cls of MASTER_ONLY_CLASSES) {
      for (const kind of ['beforeFind', 'beforeSave', 'beforeDelete']) {
        expect(calls).withContext(`${kind} ${cls}`).toContain({ kind, target: cls, fn: requireMasterKey });
      }
    }
  });

  it('usersignup refuses a caller without the master key and creates nothing', async () => {
    const created = [];
    const usersignup = makeUsersignup({ createAccount: async d => created.push(d) });
    const err = await rejection(usersignup({ params: { userDetails: { email: 'x@x.test' } }, master: false }));
    expect(err?.code).toBe(FORBIDDEN);
    expect(created).toEqual([]);
  });
  it('usersignup creates the account for a master-key caller', async () => {
    const usersignup = makeUsersignup({ createAccount: async d => ({ message: 'User sign up', email: d.email }) });
    expect(await usersignup({ params: { userDetails: { email: 'x@x.test' } }, master: true }))
      .toEqual({ message: 'User sign up', email: 'x@x.test' });
  });
  it('saveUser signs a new user up with the master key (the _User guard refuses anything else)', async () => {
    const signUps = [];
    const fakeUser = { set() {}, signUp: async (attrs, options) => {
      signUps.push(options);
      return { id: 'u1', getSessionToken: () => 'r:1' };
    } };
    const res = await saveUser({ email: 'new@x.test', password: 'p' }, { findUser: async () => undefined, newUser: () => fakeUser });
    expect(res).toEqual({ id: 'u1', sessionToken: 'r:1' });
    expect(signUps).toEqual([{ useMasterKey: true }]);
  });

  describe('addadmin', () => {
    const run = (deps, master = false) => makeAddAdmin({ addAdmin: async () => ({ sessionToken: 'r:admin' }), ...deps })(
      { params: { userDetails: { email: 'Owner@X.test' } }, master });

    it('refuses a caller without the master key once an admin exists', async () => {
      const err = await rejection(run({ hasAdmin: async () => true, findUser: async () => undefined }));
      expect(err?.code).toBe(FORBIDDEN);
    });
    it('refuses to hand out an existing user\'s session to a caller without the master key', async () => {
      const err = await rejection(run({ hasAdmin: async () => false, findUser: async () => ({ id: 'victim' }) }));
      expect(err?.code).toBe(ParseSDK.Error.USERNAME_TAKEN);
    });
    it('creates the first admin during first-run setup', async () => {
      expect(await run({ hasAdmin: async () => false, findUser: async () => undefined })).toEqual({ sessionToken: 'r:admin' });
    });
    it('is unrestricted for the master key', async () => {
      expect(await run({ hasAdmin: async () => true, findUser: async () => ({ id: 'u' }) }, true)).toEqual({ sessionToken: 'r:admin' });
    });
  });
});

// ─── A2/A5: document parties only ──────────────────────────────────────────

const doc = {
  objectId: 'doc1',
  CreatedBy: { objectId: 'owner', email: 'owner@x.test' },
  ExtUserPtr: { objectId: 'ext1', Email: 'Owner@X.test' },
  Signers: [{ Email: 'Signer@X.test', UserId: { objectId: 'signer-user' } }],
  Placeholders: [{ email: 'second@x.test' }, { Role: 'prefill' }],
};
const owner = { id: 'owner', email: 'owner@x.test' };
const signer = { id: 'signer-user', email: 'signer@x.test' };
const signerByEmail = { id: 'other-id', email: 'second@x.test' };
const stranger = { id: 'stranger', email: 'stranger@x.test' };

describe('A2 assertDocumentMailAllowed', () => {
  const allowed = (caller, to) => () => assertDocumentMailAllowed(doc, caller, recipientList(to));

  it('allows the creator to mail a signer', () => expect(allowed(owner, 'signer@x.test')).not.toThrow());
  it('allows a signer (by UserId) to mail the next signer and the owner', () =>
    expect(allowed(signer, 'second@x.test, owner@x.test')).not.toThrow());
  it('allows a signer known only by email', () => expect(allowed(signerByEmail, 'signer@x.test')).not.toThrow());
  it('refuses a stranger', () => expect(allowed(stranger, 'signer@x.test')).toThrowMatching(e => e.code === FORBIDDEN));
  it('refuses a recipient who is not a signer or the owner', () =>
    expect(allowed(owner, 'signer@x.test,outsider@x.test')).toThrowMatching(e => e.code === FORBIDDEN));
  it('refuses a missing document and an empty recipient list', () => {
    expect(() => assertDocumentMailAllowed(null, owner, ['signer@x.test'])).toThrowMatching(e => e.code === FORBIDDEN);
    expect(allowed(owner, '')).toThrowMatching(e => e.code === FORBIDDEN);
  });
  it('refuses without a documentId before loading anything', async () => {
    const loads = [];
    const err = await rejection(authorizeDocumentMail({ documentId: undefined, caller: owner, recipients: ['signer@x.test'] },
      { loadDocument: async id => loads.push(id) }));
    expect(err?.code).toBe(FORBIDDEN);
    expect(loads).toEqual([]);
  });
  it('loadMailDocument looks the document up by its id, with signers, owner and creator', async () => {
    const table = new FakeTable([{ objectId: 'other' }, { objectId: 'doc1', Name: 'Lease' }]);
    expect(await loadMailDocument('doc1', { query: () => table.query() })).toEqual({ objectId: 'doc1', Name: 'Lease' });
    expect(table.queries[0].includes).toEqual(['Signers', 'ExtUserPtr', 'CreatedBy']);
    expect(table.queries[0].options).toEqual({ useMasterKey: true });
    expect(await loadMailDocument('nope', { query: () => table.query() })).toBeNull();
  });
});

function recorder() {
  const calls = [];
  return { calls, relay: async message => { calls.push(message); return { status: 'success' }; } };
}

describe('A2/A3/A5 sendmailv3 without the master key', () => {
  const params = { documentId: 'doc1', extUserId: 'forged-ext', recipient: 'signer@x.test', subject: 'S', html: '<p>h</p>' };
  const make = (over = {}) => {
    const { calls, relay } = recorder();
    const quota = [];
    const handler = makeSendmailv3({
      relay,
      countMail: async () => {},
      sessionUser: async () => null,
      authorize: (req) => authorizeDocumentMail(req, { loadDocument: async id => (id === 'doc1' ? doc : null) }),
      consumeQuota: async (userId, n) => quota.push([userId, n]),
      ...over,
    });
    return { calls, quota, handler };
  };
  const asUser = (user) => ({ id: user.id, get: k => (k === 'email' ? user.email : undefined) });

  it('relays for the creator, with the verified documentId and the document owner as extUserId', async () => {
    const { calls, quota, handler } = make();
    expect(await handler({ params, user: asUser(owner), headers: {} })).toEqual({ status: 'success' });
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(jasmine.objectContaining({ documentId: 'doc1', extUserId: 'ext1', to: 'signer@x.test' }));
    expect(quota).toEqual([['owner', 1]]);
  });
  it('relays for a signer', async () => {
    const { calls, handler } = make();
    await handler({ params: { ...params, recipient: 'second@x.test' }, user: asUser(signer), headers: {} });
    expect(calls.length).toBe(1);
  });
  it('refuses a stranger, a non-signer recipient and a missing documentId, relaying nothing', async () => {
    const { calls, quota, handler } = make();
    const cases = [
      { params, user: asUser(stranger) },
      { params: { ...params, bcc: 'outsider@x.test' }, user: asUser(owner) },
      { params: { ...params, documentId: undefined }, user: asUser(owner) },
    ];
    for (const req of cases) {
      const err = await rejection(handler({ ...req, headers: {} }));
      expect(err?.code).withContext(JSON.stringify(req.params)).toBe(FORBIDDEN);
    }
    expect(calls).toEqual([]);
    expect(quota).toEqual([]);
  });
  it('resolves the legacy sessionToken header to a user, then applies the same checks', async () => {
    const { calls, handler } = make({ sessionUser: async t => (t === 'r:signer' ? asUser(signer) : null) });
    await handler({ params: { ...params, recipient: 'owner@x.test' }, headers: { sessiontoken: 'r:signer' } });
    expect(calls.length).toBe(1);
    const err = await rejection(handler({ params, headers: { sessiontoken: 'r:forged' } }));
    expect(err?.code).toBe(FORBIDDEN);
    expect(calls.length).toBe(1);
  });
  it('refuses when the daily limit is reached, before relaying', async () => {
    const { calls, handler } = make({ consumeQuota: async () => { throw new Parse.Error(FORBIDDEN, 'Daily email limit reached'); } });
    const err = await rejection(handler({ params, user: asUser(owner), headers: {} }));
    expect(err?.message).toBe('Daily email limit reached');
    expect(calls).toEqual([]);
  });
  it('leaves master-key callers unchanged: no document check, documentId passed through', async () => {
    const { calls, quota, handler } = make({ authorize: async () => { throw new Error('must not be called'); } });
    await handler({ params: { ...params, documentId: 'any-doc', recipient: 'anyone@x.test' }, master: true, headers: {} });
    expect(calls[0]).toEqual(jasmine.objectContaining({ documentId: 'any-doc', extUserId: 'forged-ext', to: 'anyone@x.test' }));
    expect(quota).toEqual([]);
  });
});

describe('A2/A3 forwarddoc without the master key', () => {
  const make = (over = {}) => {
    const sent = [];
    const quota = [];
    const handler = makeForwardDoc({
      send: async p => { sent.push(p); return { status: 'success' }; },
      loadDocument: async id => (id === 'doc1' ? { ...doc, Name: 'Lease', SignedUrl: '' } : null),
      consumeQuota: async (userId, n) => quota.push([userId, n]),
      ...over,
    });
    return { sent, quota, handler };
  };
  const user = u => ({ id: u.id, get: k => (k === 'email' ? u.email : undefined) });

  it('forwards for a signer to the document\'s parties, counting every recipient', async () => {
    const { sent, quota, handler } = make();
    await handler({ params: { docId: 'doc1', recipients: ['owner@x.test', 'second@x.test'] }, user: user(signer) });
    expect(sent.map(p => [p.recipient, p.documentId])).toEqual([['owner@x.test', 'doc1'], ['second@x.test', 'doc1']]);
    expect(quota).toEqual([['signer-user', 2]]);
  });
  it('refuses a stranger and an outside recipient', async () => {
    const { sent, handler } = make();
    expect((await rejection(handler({ params: { docId: 'doc1', recipients: ['owner@x.test'] }, user: user(stranger) })))?.code).toBe(FORBIDDEN);
    expect((await rejection(handler({ params: { docId: 'doc1', recipients: ['outsider@x.test'] }, user: user(owner) })))?.code).toBe(FORBIDDEN);
    expect(sent).toEqual([]);
  });
});

// ─── A3: daily limit ───────────────────────────────────────────────────────

describe('A3 daily recipient limit', () => {
  const now = () => new Date('2026-09-24T10:00:00Z');

  it('counts recipients per user and day, and refuses (uncounted) past 50', async () => {
    const table = new FakeTable();
    const consume = makeMailQuota({ counter: parseMailCounter({ query: () => table.query(), create: () => table.create() }), now });
    expect(await consume('u1', 30)).toBe(30);
    expect(await consume('u1', 20)).toBe(50);
    const err = await rejection(consume('u1', 1));
    expect(err?.code).toBe(FORBIDDEN);
    expect(err?.message).toBe('Daily email limit reached');
    expect(await consume('u2', 5)).withContext('another user has their own count').toBe(5);
    expect(table.rows.find(r => r.userId === 'u1')).toEqual(jasmine.objectContaining({ day: '2026-09-24', count: 50 }));
    // Every change is an atomic increment with the master key.
    expect(table.saves.every(s => s.options?.useMasterKey === true && Object.keys(s.ops).join() === 'count')).toBe(true);
  });
  it('starts a new count on a new day', async () => {
    const table = new FakeTable([{ objectId: 'r1', userId: 'u1', day: '2026-09-23', count: 50 }]);
    const consume = makeMailQuota({ counter: parseMailCounter({ query: () => table.query(), create: () => table.create() }), now });
    expect(await consume('u1', 10)).toBe(10);
  });
  it('sums every row of a user-day, so a creation race cannot split the count', async () => {
    const table = new FakeTable([
      { objectId: 'r1', userId: 'u1', day: '2026-09-24', count: 30 },
      { objectId: 'r2', userId: 'u1', day: '2026-09-24', count: 20 },
    ]);
    const consume = makeMailQuota({ counter: parseMailCounter({ query: () => table.query(), create: () => table.create() }), now });
    expect((await rejection(consume('u1', 1)))?.code).toBe(FORBIDDEN);
  });
});

// ─── A4: OTP attempts ──────────────────────────────────────────────────────

describe('A4 OTP attempt limit (AuthLoginAsMail)', () => {
  let clock;
  const setup = () => {
    clock = new Date('2026-09-24T10:00:00Z');
    const table = new FakeTable([{ objectId: 'o1', Email: 'signer@x.test', OTP: 4321, FailedAttempts: 0 }]);
    const logins = [];
    const handler = makeAuthLoginAsMail({
      store: parseOtpStore({ query: () => table.query() }),
      login: async email => { logins.push(email); return { sessionToken: 'r:ok' }; },
      now: () => clock,
    });
    const attempt = otp => handler({ params: { email: 'signer@x.test', otp: String(otp) } });
    return { table, logins, attempt };
  };

  it('logs in with the right code', async () => {
    const { attempt, logins } = setup();
    expect(await attempt(4321)).toEqual({ sessionToken: 'r:ok' });
    expect(logins).toEqual(['signer@x.test']);
  });
  it('after 5 wrong codes withdraws the code and refuses even the right one for 15 minutes', async () => {
    const { attempt, logins, table } = setup();
    for (let i = 1; i < MAX_OTP_ATTEMPTS; i++) expect(await attempt(1111)).toBe('Invalid Otp');
    expect((await rejection(attempt(1111)))?.code).withContext('5th wrong code').toBe(FORBIDDEN);
    expect(table.rows[0].OTP).withContext('code withdrawn').toBeUndefined();
    expect((await rejection(attempt(4321)))?.code).withContext('right code while locked').toBe(FORBIDDEN);
    clock = new Date(clock.getTime() + OTP_LOCK_MS + 1000);
    expect((await rejection(attempt(4321)))?.code).withContext('old code after the lock: a new one is needed').toBe(FORBIDDEN);
    expect(logins).toEqual([]);
  });
  // SendMailOTPv1 resets FailedAttempts with every new code, so only LockedUntil stops a
  // guesser from requesting code after code and trying 5 guesses on each.
  it('refuses even a newly requested code while the 15-minute lock lasts', async () => {
    const { attempt, logins, table } = setup();
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) await rejection(attempt(1111));
    clock = new Date(clock.getTime() + OTP_LOCK_MS - 60 * 1000);
    Object.assign(table.rows[0], { OTP: 9876, FailedAttempts: 0 });
    expect((await rejection(attempt(9876)))?.code).toBe(FORBIDDEN);
    expect(logins).toEqual([]);
  });
  it('a new code after the lock works again (SendMailOTPv1 resets FailedAttempts)', async () => {
    const { attempt, table } = setup();
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) await rejection(attempt(1111));
    clock = new Date(clock.getTime() + OTP_LOCK_MS + 1000);
    Object.assign(table.rows[0], { OTP: 9876, FailedAttempts: 0 });
    expect(await attempt(9876)).toEqual({ sessionToken: 'r:ok' });
  });
  it('counts every try before checking it, so concurrent guesses cannot exceed the limit', async () => {
    const { attempt, logins } = setup();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => rejection(attempt(i === 19 ? 4321 : 1000 + i))));
    expect(results.filter(r => r === null).length).toBeLessThanOrEqual(MAX_OTP_ATTEMPTS);
    expect(logins).toEqual([]);
  });
});

// ─── D2: the real session-token lookup ─────────────────────────────────────

describe('userForSessionToken', () => {
  const now = () => new Date('2026-09-24T10:00:00Z');
  const alice = { id: 'alice' };
  const table = new FakeTable([
    { sessionToken: 'r:expired', expiresAt: new Date('2026-09-01T00:00:00Z'), user: { id: 'old' } },
    { sessionToken: 'r:valid', expiresAt: new Date('2026-10-01T00:00:00Z'), user: alice },
    { sessionToken: 'r:nouser', expiresAt: new Date('2026-10-01T00:00:00Z') },
  ]);
  const lookup = token => userForSessionToken(token, { query: () => table.query(), now });

  it('returns the user of a live session', async () => expect(await lookup('r:valid')).toBe(alice));
  it('returns null for an expired, unknown or userless session, and for no token', async () => {
    expect(await lookup('r:expired')).toBeNull();
    expect(await lookup('r:unknown')).toBeNull();
    expect(await lookup('r:nouser')).toBeNull();
    expect(await lookup('')).toBeNull();
  });
  it('reads the session with the master key and includes the user (for its email)', async () => {
    await lookup('r:valid');
    const last = table.queries.at(-1);
    expect(last.options).toEqual({ useMasterKey: true });
    expect(last.includes).toEqual(['user']);
  });
});
