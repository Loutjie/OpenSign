import { claimOtp } from '../cloud/parsefunction/otpClaim.js';

describe('atomic OTP claim against the Parse Mongo collection', () => {
  it('allows one concurrent claim and never clears a replacement code', async () => {
    const Otp = Parse.Object.extend('defaultdata_Otp');
    const email = 'atomic-otp@test.example';
    const now = new Date('2030-01-01T00:00:00Z');
    const row = await new Otp().save({
      Email: email, OTP: 123456, ExpiresAt: new Date('2030-01-01T00:10:00Z'), FailedAttempts: 0,
    }, { useMasterKey: true });

    const claims = await Promise.all([claimOtp(email, 123456, now), claimOtp(email, 123456, now)]);
    expect(claims.sort()).toEqual([false, true]);
    let saved = await new Parse.Query('defaultdata_Otp').get(row.id, { useMasterKey: true });
    expect(saved.get('OTP')).toBeUndefined();
    expect(saved.get('UsedAt')).toEqual(jasmine.any(Date));

    saved.set('OTP', 654321);
    saved.set('ExpiresAt', new Date('2030-01-01T00:20:00Z'));
    saved.unset('UsedAt');
    await saved.save(null, { useMasterKey: true });
    expect(await claimOtp(email, 123456, now)).toBeFalse();
    saved = await new Parse.Query('defaultdata_Otp').get(row.id, { useMasterKey: true });
    expect(saved.get('OTP')).toBe(654321);
    expect(await claimOtp(email, 654321, now)).toBeTrue();
  });
});
