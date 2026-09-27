import { parseOtpStore, verifyAndConsumeOtp } from './AuthLoginAsMail.js';

async function loadUser(request) {
  const userQuery = new Parse.Query(Parse.User);
  return userQuery.get(request.user.id, { sessionToken: request.user.getSessionToken() });
}

export function makeVerifyEmail({ store = parseOtpStore(), now = () => new Date(), loadUser: getUser = loadUser } = {}) {
  return async function VerifyEmail(request) {
    if (!request?.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
    }
    const email = request.params.email;
    if (String(email || '').trim().toLowerCase() !== String(request.user.get('email') || '').trim().toLowerCase()) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'OTP email does not match the signed-in user.');
    }

    const claimed = await verifyAndConsumeOtp(store, email, request.params.otp, now);
    if (!claimed) {
      const error = new Error('OTP is invalid.');
      error.code = 400;
      throw error;
    }
    if (request.user.get('emailVerified')) return { message: 'Email is already verified.' };

    const user = await getUser(request);
    user.set('emailVerified', true);
    if (await user.save(null, { useMasterKey: true })) return { message: 'Email is verified.' };
    const error = new Error('Something went wrong, please try again later!');
    error.code = 400;
    throw error;
  };
}

export default makeVerifyEmail();
