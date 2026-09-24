import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

// A code is four digits, so it must not be guessable by trying them all: after
// MAX_OTP_ATTEMPTS wrong codes the code is withdrawn (a new one must be requested) and
// the email is refused for OTP_LOCK_MS.
export const MAX_OTP_ATTEMPTS = 5;
export const OTP_LOCK_MS = 15 * 60 * 1000;
export const OTP_LOCKED_MESSAGE = 'Too many incorrect codes. Request a new code in 15 minutes.';

// defaultdata_Otp {Email, OTP, FailedAttempts, LockedUntil}; SendMailOTPv1 writes the code
// and resets FailedAttempts. The class is master-key only (accessGuards.js).
export function parseOtpStore({ query = () => new Parse.Query('defaultdata_Otp') } = {}) {
  const find = email => query().equalTo('Email', email).first({ useMasterKey: true });
  return {
    async get(email) {
      const row = await find(email);
      if (!row) return null;
      return { otp: row.get('OTP'), lockedUntil: row.get('LockedUntil') || null };
    },
    // Atomic ($inc); returns the count including this attempt.
    async countAttempt(email) {
      const row = await find(email);
      row.increment('FailedAttempts');
      await row.save(null, { useMasterKey: true });
      return Number(row.get('FailedAttempts')) || 0;
    },
    // Withdraws the code. FailedAttempts stays at the limit, so a try that raced past the
    // lock is still refused; SendMailOTPv1 resets it with the next code.
    async lock(email, until) {
      const row = await find(email);
      row.unset('OTP');
      row.set('LockedUntil', until);
      await row.save(null, { useMasterKey: true });
    },
    async clearAttempts(email) {
      const row = await find(email);
      row.set('FailedAttempts', 0);
      await row.save(null, { useMasterKey: true });
    },
  };
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
    const otp = parseInt(request.params.otp);
    const email = request.params.email;
    try {
      const entry = await store.get(email);
      if (!entry) return 'user not found!';
      if (entry.lockedUntil && entry.lockedUntil > now()) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
      }
      // Count the try before checking it, so concurrent guesses cannot get past the limit.
      const attempt = await store.countAttempt(email);
      if (attempt > MAX_OTP_ATTEMPTS) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
      }
      if (entry.otp === undefined || entry.otp === null || entry.otp !== otp) {
        if (attempt >= MAX_OTP_ATTEMPTS) {
          await store.lock(email, new Date(now().getTime() + OTP_LOCK_MS));
          throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, OTP_LOCKED_MESSAGE);
        }
        return 'Invalid Otp';
      }
      await store.clearAttempts(email);
      const result = await login(email);
      return result || 'user not found!';
    } catch (err) {
      if (err instanceof Parse.Error) throw err;
      console.log('err in Auth', { message: err?.message });
      return 'Result not found';
    }
  };
}

export default makeAuthLoginAsMail();
