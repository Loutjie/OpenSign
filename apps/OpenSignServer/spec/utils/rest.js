// REST calls against the Parse server spec/helper.js starts (spec/utils/test-runner.js),
// as a client would make them: app ID, and a session token or the master key. Use it for
// rules a client hits over HTTP (CLPs, ACLs, beforeSave triggers, cloud functions with a
// real request.user), which calling a handler directly would skip.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:30001/test';
const APP_ID = 'test';
const MASTER_KEY = 'test';
const JAVASCRIPT_KEY = 'test';

export async function rest(method, path, { body, session, master = false } = {}) {
  // test-runner.js sets javascriptKey, so Parse requires a client key on non-master calls.
  const headers = {
    'X-Parse-Application-Id': APP_ID,
    'X-Parse-Javascript-Key': JAVASCRIPT_KEY,
    'Content-Type': 'application/json',
  };
  if (session) headers['X-Parse-Session-Token'] = session;
  if (master) headers['X-Parse-Master-Key'] = MASTER_KEY;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

export const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

// A unique suffix, so a spec's rows never collide with another spec's in the shared DB.
export const uniq = () => randomBytes(4).toString('hex');

// Creates a _User with the master key (self-signup is closed) and logs it in.
export async function makeUser(email, password = `pw-${uniq()}`) {
  const created = await rest('POST', '/users', {
    master: true,
    body: { username: email, email, password },
  });
  if (created.status !== 201) throw new Error(`makeUser ${email}: ${JSON.stringify(created.body)}`);
  const login = await rest('POST', '/login', { body: { username: email, password } });
  if (login.status !== 200) throw new Error(`makeUser ${email}: login ${JSON.stringify(login.body)}`);
  return { id: created.body.objectId, email, password, session: login.body.sessionToken };
}

// Returns the session token, or null when the credentials are refused.
export async function logIn(username, password) {
  const res = await rest('POST', '/login', { body: { username, password } });
  return res.status === 200 ? res.body.sessionToken : null;
}
