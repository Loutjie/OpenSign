import {
  generateOtp,
  msUntil,
  sendDeleteOtpEmail,
  OTP_EXPIRES_MIN,
  RESEND_COOLDOWN_SEC,
} from './deleteUtils.js';
import { errorSummary } from '../../parsefunction/sendmailClient.js';

async function findExtUser(userId) {
  const extUserQuery = new Parse.Query('contracts_Users');
  extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  extUserQuery.include('TenantId');
  return extUserQuery.first({ useMasterKey: true });
}

export function makeDeleteUserOtp({ findUser = findExtUser, sendOtp = sendDeleteOtpEmail, now = () => Date.now() } = {}) {
  return async (req, res) => {
    const { userId } = req.params;

    const extUser = await findUser(userId);
    if (!extUser) return res.status(404).json({ error: 'User not found' });

    const nowMs = now();
    const lastSentAt = extUser.get('DeleteOTPSentAt')?.getTime?.() || 0;
    const cooldownEndsAt = lastSentAt + RESEND_COOLDOWN_SEC * 1000;
    const remainingMs = msUntil(nowMs, cooldownEndsAt);

    if (remainingMs > 0) {
      return res
        .status(429)
        .json({ error: 'Cooldown not finished', retryAfterSec: Math.ceil(remainingMs / 1000) });
    }

    const otp = generateOtp();
    const expiresAt = new Date(nowMs + OTP_EXPIRES_MIN * 60 * 1000);

    try {
      // Throws unless the email was sent: no { ok: true } for a code nobody received.
      await sendOtp(extUser, otp);
      extUser.set('DeleteOTP', otp);
      extUser.set('DeleteOTPExpiry', expiresAt);
      extUser.set('DeleteOTPSentAt', new Date(nowMs));
      extUser.set('DeleteOTPTries', 0); // reset tries on resend
      await extUser.save(null, { useMasterKey: true });
      return res.json({ ok: true, cooldownSec: RESEND_COOLDOWN_SEC, expiresInMin: OTP_EXPIRES_MIN });
    } catch (err) {
      // Never the whole error: its request body carries the OTP.
      console.log('Error sending delete OTP (POST /otp):', errorSummary(err));
      return res.status(500).json({ error: 'Failed to send OTP' });
    }
  };
}

export const deleteUserOtp = makeDeleteUserOtp();
