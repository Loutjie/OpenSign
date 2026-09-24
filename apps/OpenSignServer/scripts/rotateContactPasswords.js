#!/usr/bin/env node
// One-off: give a random password to every OpenSign account whose password is still its
// own email address. Contact accounts (every tenant LeaseLynx added, and contacts added in
// the OpenSign UI) were created that way until d4b8ba540, so anyone who knew a signer's
// email could sign in as them. Contacts sign in by emailed code, so nobody needs the old one.
//
//   SERVER_URL=https://<opensign-server>/app MASTER_KEY=... [APP_ID=opensign] \
//     node scripts/rotateContactPasswords.js [--apply] [--exclude user@x ...]
//
// Dry run by default: it checks and counts, and writes only with --apply. Admin accounts
// (a contracts_Users row with UserRole contracts_Admin) and every --exclude username are
// skipped without being checked. A password is checked with POST /verifyPassword, which
// opens no session and keeps the password out of the URL. At most RATE_PER_SECOND calls a
// second. It prints counts only, never an address or a password.
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ParseSDK from 'parse/node';

export const RATE_PER_SECOND = 5;
const PAGE_SIZE = 100;
const ADMIN_ROLE = 'contracts_Admin';
const INVALID_USERNAME_PASSWORD = 101; // Parse.Error.OBJECT_NOT_FOUND

const normalise = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const newPassword = () => crypto.randomBytes(32).toString('hex');

export function parseArgs(argv) {
  const options = { apply: false, exclude: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--exclude' || arg.startsWith('--exclude=')) {
      const value = arg === '--exclude' ? argv[(i += 1)] : arg.slice('--exclude='.length);
      if (!value || value.startsWith('--')) throw new Error('--exclude needs a username');
      options.exclude.push(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// Spaces successive calls at least 1/perSecond apart.
export function makeRateLimiter(
  perSecond,
  { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}
) {
  const interval = 1000 / perSecond;
  let next = -Infinity;
  return async () => {
    const start = Math.max(now(), next);
    const wait = start - now();
    if (wait > 0) await sleep(wait);
    next = start + interval;
  };
}

// true when `password` is the account's password, false when it is not; throws otherwise.
export function makeVerifyPassword({ serverUrl, appId, fetchImpl = fetch }) {
  const url = `${serverUrl.replace(/\/+$/, '')}/verifyPassword`;
  return async (username, password) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'X-Parse-Application-Id': appId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) return true;
    const body = await res.json().catch(() => ({}));
    if (body?.code === INVALID_USERNAME_PASSWORD) return false;
    throw new Error(`verifyPassword answered HTTP ${res.status} (code ${body?.code})`);
  };
}

// Every row of `className`, a page at a time, in objectId order.
async function* allRows(Parse, className, configure = () => {}) {
  let last;
  for (;;) {
    const query = new Parse.Query(className);
    configure(query);
    query.ascending('objectId');
    query.limit(PAGE_SIZE);
    if (last) query.greaterThan('objectId', last);
    const page = await query.find({ useMasterKey: true });
    yield* page;
    if (page.length < PAGE_SIZE) return;
    last = page[page.length - 1].id;
  }
}

// The _User ids of every OpenSign admin. OpenSign links a profile by UserId, LeaseLynx by UserPtr.
async function adminUserIds(Parse) {
  const ids = new Set();
  const admins = q => q.equalTo('UserRole', ADMIN_ROLE);
  for await (const row of allRows(Parse, 'contracts_Users', admins)) {
    for (const key of ['UserId', 'UserPtr']) {
      const id = row.get(key)?.id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

// 'admin' | 'excluded' | 'no-email' are skipped unchecked; 'check' is tried.
export function classifyUser(user, { adminIds, exclude }) {
  if (adminIds.has(user.id)) return 'admin';
  if (exclude.has(normalise(user.get('username'))) || exclude.has(normalise(user.get('email')))) {
    return 'excluded';
  }
  if (!user.get('email') || !user.get('username')) return 'no-email';
  return 'check';
}

export async function rotateContactPasswords({
  Parse,
  verifyPassword,
  apply = false,
  exclude = [],
  limiter = makeRateLimiter(RATE_PER_SECOND),
}) {
  const counts = { checked: 0, matched: 0, rotated: 0, skipped: 0, errors: 0 };
  const context = { adminIds: await adminUserIds(Parse), exclude: new Set(exclude.map(normalise)) };
  for await (const user of allRows(Parse, '_User')) {
    if (classifyUser(user, context) !== 'check') {
      counts.skipped += 1;
      continue;
    }
    await limiter();
    counts.checked += 1;
    let matches;
    try {
      matches = await verifyPassword(user.get('username'), user.get('email'));
    } catch {
      counts.errors += 1;
      continue;
    }
    if (!matches) continue;
    counts.matched += 1;
    if (!apply) continue;
    await limiter();
    try {
      user.set('password', newPassword());
      await user.save(null, { useMasterKey: true });
      counts.rotated += 1;
    } catch {
      counts.errors += 1;
    }
  }
  return counts;
}

async function main() {
  const { apply, exclude } = parseArgs(process.argv.slice(2));
  const { SERVER_URL, MASTER_KEY, APP_ID = 'opensign' } = process.env;
  if (!SERVER_URL || !MASTER_KEY) {
    throw new Error('SERVER_URL and MASTER_KEY must be set');
  }
  ParseSDK.initialize(APP_ID);
  ParseSDK.masterKey = MASTER_KEY;
  ParseSDK.serverURL = SERVER_URL;
  const counts = await rotateContactPasswords({
    Parse: ParseSDK,
    verifyPassword: makeVerifyPassword({ serverUrl: SERVER_URL, appId: APP_ID }),
    apply,
    exclude,
  });
  console.log(`${apply ? 'apply' : 'dry run'}: ${JSON.stringify(counts)}`);
  if (counts.errors) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`rotateContactPasswords failed: ${err?.message}`);
    process.exitCode = 1;
  });
}
