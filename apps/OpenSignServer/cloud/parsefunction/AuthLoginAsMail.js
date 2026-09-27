import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { claimOtp, otpKey } from './otpClaim.js';

// A code has six digits, but guesses must still be bounded: after
// MAX_OTP_ATTEMPTS wrong codes the code is withdrawn (a new one must be requested) and
// the email is refused for OTP_LOCK_MS.
export const MAX_OTP_ATTEMPTS = 5;
export const OTP_LOCK_MS = 15 * 60 * 1000;
export const OTP_LOCKED_MESSAGE = 'Too many incorrect codes. Request a new code in 15 minutes.';

// defaultdata_Otp {Email, OTP, ExpiresAt, FailedAttempts, LockedUntil, UsedAt};
// resends preserve failed attempts until a lock expires. The class is master-key only.
export function parseOtpStore({ query = () => new Parse.Query('defaultdata_Otp') } = {}) {
  const find = email => query().equalTo('objectId', otpKey(email)).first({ useMasterKey: true });
  return {
    async get(email) {
      const row = await find(email);
      if (!row) return null;
      return { otp: row.get('OTP'), expiresAt: row.get('ExpiresAt') || null, lockedUntil: row.get('LockedUntil') || null };
    },
    // Atomic ($inc); returns the count including this attempt.
    async countAttempt(email) {
      const row = await find(email);
      row.increment('FailedAttempts');
      await row.save(null, { useMasterKey: true });
      return Number(row.get('FailedAttempts')) || 0;
    },
    // Withdraws the code. FailedAttempts stays at the limit, so a try that raced past the
    // lock is still refused; only a resend after the lock expires resets it.
    async lock(email, until) {
      const row = await find(email);
      row.unset('OTP');
      row.set('LockedUntil', until);
      await row.save(null, { useMasterKey: true });
    },
    claim: claimOtp,
  };
}

export async function verifyAndConsumeOtp(store, email, suppliedOtp, now = () => new Date()) {
  const entry = await store.get(email);
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil > now()) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
  }
  if (!entry.expiresAt || entry.expiresAt <= now() || entry.otp == null) return false;
  const attempt = await store.countAttempt(email);
  if (attempt > MAX_OTP_ATTEMPTS) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
  }
  const supplied = String(suppliedOtp ?? '');
  if (!/^\d{6}$/.test(supplied) || entry.otp !== Number(supplied)) {
    if (attempt >= MAX_OTP_ATTEMPTS) {
      await store.lock(email, new Date(now().getTime() + OTP_LOCK_MS));
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
    }
    return false;
  }
  return store.claim(email, Number(supplied), now());
}

// Logs the user in by objectId (Parse's loginAs, master key) without touching the password.
async function loginByEmail(email) {
  const user = await new Parse.Query(Parse.User).equalTo('email', email).first({ useMasterKey: true });
  if (!user) return null;
  let login;
  try {
    const res = await axios({
      method: 'POST',
      url: `${cloudServerUrl}/loginAs`,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': serverAppId,
        'X-Parse-Master-Key': process.env.MASTER_KEY,
      },
      params: { userId: user.id },
    });
    login = res.data;
  } catch (err) {
    console.log('AuthLoginAsMail loginAs failed', { message: err?.message, status: err?.response?.status });
    return null;
  }
  if (login && !login.emailVerified) {
    user.set('emailVerified', true);
    await user.save(null, { useMasterKey: true });
  }
  return login || null;
}

export function makeAuthLoginAsMail({
  store = parseOtpStore(),
  login = loginByEmail,
  now = () => new Date(),
} = {}) {
  return async function AuthLoginAsMail(request) {
    const email = request.params.email;
    try {
      const claimed = await verifyAndConsumeOtp(store, email, request.params.otp, now);
      if (claimed === null) return 'user not found!';
      if (!claimed) return 'Invalid Otp';
      const result = await login(email);
      if (!result) {
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Sign-in is temporarily unavailable. Request a new code.');
      }
      return result;
    } catch (err) {
      if (err instanceof Parse.Error) throw err;
      console.log('err in Auth', { message: err?.message });
      return 'Result not found';
    }
  };
}

export default makeAuthLoginAsMail();
