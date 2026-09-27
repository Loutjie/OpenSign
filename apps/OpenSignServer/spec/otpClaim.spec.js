import { claimOtp, otpKey, rollbackOtp, storeOtp } from '../cloud/parsefunction/otpClaim.js';

describe('atomic OTP claim against the Parse Mongo collection', () => {
  it('allows one concurrent claim and never clears a replacement code', async () => {
    const email = 'atomic-otp@test.example';
    const now = new Date('2030-01-01T00:00:00Z');
    await storeOtp(email, 123456, null, new Date('2030-01-01T00:10:00Z'), now);
    const row = await new Parse.Query('defaultdata_Otp').equalTo('objectId', otpKey(email)).first({ useMasterKey: true });
    expect(row?.get('OTP')).toBe(123456);

    const claims = await Promise.all([claimOtp(email, 123456, now), claimOtp(email, 123456, now)]);
    expect(claims.sort()).toEqual([false, true]);
    let saved = await new Parse.Query('defaultdata_Otp').get(row.id, { useMasterKey: true });
    expect(saved.get('OTP')).toBeUndefined();
    expect(saved.get('UsedAt')).toEqual(jasmine.any(Date));

    await storeOtp(email, 654321, null, new Date('2030-01-01T00:20:00Z'), new Date('2030-01-01T00:01:00Z'));
    expect(await claimOtp(email, 123456, now)).toBeFalse();
    saved = await new Parse.Query('defaultdata_Otp').get(row.id, { useMasterKey: true });
    expect(saved.get('OTP')).toBe(654321);
    expect(await claimOtp(email, 654321, now)).toBeTrue();
  });

  it('keeps one readable OTP row across parallel first sends', async () => {
    const email = 'parallel-first-send@test.example';
    const expiry = new Date('2030-01-01T00:10:00Z');
    const now = new Date('2030-01-01T00:00:00Z');
    const results = await Promise.allSettled([storeOtp(email, 123456, null, expiry, now), storeOtp(email, 654321, null, expiry, now)]);
    expect(results.filter(result => result.status === 'fulfilled').length).toBe(1);
    expect(results.filter(result => result.status === 'rejected')[0].reason.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    const rows = await new Parse.Query('defaultdata_Otp').equalTo('Email', email).find({ useMasterKey: true });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(otpKey(email));
    expect([123456, 654321]).toContain(rows[0].get('OTP'));
  });

  it('preserves failed attempts across resends and clears them only after an expired lock', async () => {
    const email = 'attempts-across-resends@test.example';
    const start = new Date('2030-01-01T00:00:00Z');
    await storeOtp(email, 123456, null, new Date('2030-01-01T00:10:00Z'), start);
    let row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    row.set('FailedAttempts', 4);
    await row.save(null, { useMasterKey: true });
    await storeOtp(email, 654321, null, new Date('2030-01-01T00:12:00Z'), new Date('2030-01-01T00:01:00Z'));
    row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect(row.get('FailedAttempts')).toBe(4);
    row.set('LockedUntil', new Date('2030-01-01T00:15:00Z'));
    await row.save(null, { useMasterKey: true });
    await expectAsync(storeOtp(email, 987654, null, new Date('2030-01-01T00:12:00Z'), new Date('2030-01-01T00:02:00Z')))
      .toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN }));
    row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect(row.get('OTP')).toBe(654321);
    expect(row.get('FailedAttempts')).toBe(4);
    await storeOtp(email, 987654, null, new Date('2030-01-01T00:30:00Z'), new Date('2030-01-01T00:16:00Z'));
    row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect(row.get('FailedAttempts')).toBe(0);
    expect(row.get('LockedUntil')).toBeUndefined();
  });

  it('rejects a resend at 59 seconds, accepts at 60 seconds, and keeps the old code after rejection', async () => {
    const email = 'minute-boundary@test.example';
    const start = new Date('2030-01-01T00:00:00Z');
    await storeOtp(email, 123456, null, new Date('2030-01-01T00:10:00Z'), start);
    const tooSoon = new Date(start.getTime() + 59 * 1000);
    await expectAsync(storeOtp(email, 654321, null, new Date(tooSoon.getTime() + 10 * 60 * 1000), tooSoon))
      .toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN }));
    let row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect([row.get('OTP'), row.get('SendCount'), row.get('LastSentAt')]).toEqual([123456, 1, start]);
    const allowed = new Date(start.getTime() + 60 * 1000);
    await storeOtp(email, 654321, null, new Date(allowed.getTime() + 10 * 60 * 1000), allowed);
    row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect([row.get('OTP'), row.get('SendCount')]).toEqual([654321, 2]);
  });

  it('restores a prior valid code and send allowance after a definite relay refusal', async () => {
    const email = 'relay-rollback@test.example';
    const start = new Date('2030-01-01T00:00:00Z');
    await storeOtp(email, 123456, null, new Date('2030-01-01T00:10:00Z'), start);
    const resendAt = new Date(start.getTime() + 60 * 1000);
    const reservation = await storeOtp(email, 654321, null, new Date('2030-01-01T00:11:00Z'), resendAt);
    await rollbackOtp(reservation);
    const row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect([row.get('OTP'), row.get('SendCount'), row.get('LastSentAt')]).toEqual([123456, 1, start]);
    expect(await claimOtp(email, 123456, resendAt)).toBeTrue();
  });

  it('caps code requests per email at ten per day and resets the next day', async () => {
    const email = 'daily-send-limit@test.example';
    const start = new Date('2030-01-01T00:00:00Z');
    for (let i = 0; i < 10; i++) {
      const now = new Date(start.getTime() + i * 60 * 1000);
      await storeOtp(email, 100000 + i, null, new Date(now.getTime() + 10 * 60 * 1000), now);
    }
    const eleventh = new Date(start.getTime() + 10 * 60 * 1000);
    await expectAsync(storeOtp(email, 999999, null, new Date(eleventh.getTime() + 10 * 60 * 1000), eleventh))
      .toBeRejectedWith(jasmine.objectContaining({ code: Parse.Error.OPERATION_FORBIDDEN }));
    let row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect(row.get('SendCount')).toBe(10);
    const tomorrow = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await storeOtp(email, 654321, null, new Date(tomorrow.getTime() + 10 * 60 * 1000), tomorrow);
    row = await new Parse.Query('defaultdata_Otp').get(otpKey(email), { useMasterKey: true });
    expect(row.get('SendCount')).toBe(1);
  });
});
