import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import Parse from 'parse/node';

let clientPromise;

function databaseUri() {
  if (process.env.DATABASE_URI) return process.env.DATABASE_URI;
  if (process.env.TESTING && process.env.MONGODB_URI) {
    return `${process.env.MONGODB_URI.replace(/\/$/, '')}/parse-test`;
  }
  return process.env.MONGODB_URI || 'mongodb://localhost:27017/dev';
}

async function otpCollection() {
  if (!clientPromise) {
    clientPromise = new MongoClient(databaseUri()).connect().catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }
  return (await clientPromise).db().collection('defaultdata_Otp');
}

const normalise = email => String(email || '').trim().toLowerCase();
export const otpKey = email => `o${createHash('sha256').update(normalise(email)).digest('hex').slice(0, 24)}`;
const MIN_RESEND_MS = 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_SENDS = 10;

// _id is unique by construction, including for concurrent first sends. Older
// random-ID OTP rows are ignored; all new readers use this key.
export async function storeOtp(email, code, tenantId, expiresAt, now = new Date()) {
  const collection = await otpCollection();
  const key = otpKey(email);
  // A completed 15-minute lock can be reset when a fresh code is requested.
  // The filter prevents this reset from clearing a newer concurrent lock.
  const existing = await collection.findOne({ _id: key }, { projection: { LockedUntil: 1, SendWindowStart: 1 } });
  if (existing?.LockedUntil && existing.LockedUntil > now) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Too many incorrect codes. Please try again after the temporary lock expires.');
  }
  if (existing?.LockedUntil && existing.LockedUntil <= now) {
    await collection.updateOne({ _id: key, LockedUntil: existing.LockedUntil }, {
      $unset: { LockedUntil: '' }, $set: { FailedAttempts: 0 },
    });
  }
  if (existing && (!existing.SendWindowStart || existing.SendWindowStart <= new Date(now.getTime() - DAILY_WINDOW_MS))) {
    await collection.updateOne({
      _id: key,
      ...(existing.SendWindowStart ? { SendWindowStart: existing.SendWindowStart } : { SendWindowStart: { $exists: false } }),
    }, { $set: { SendWindowStart: now, SendCount: 0 } });
  }
  try {
    const previous = await collection.findOneAndUpdate({
      _id: key,
      $and: [
        { $or: [{ LockedUntil: { $exists: false } }, { LockedUntil: { $lte: now } }] },
        { $or: [{ LastSentAt: { $exists: false } }, { LastSentAt: { $lte: new Date(now.getTime() - MIN_RESEND_MS) } }] },
        { $or: [{ SendCount: { $exists: false } }, { SendCount: { $lt: MAX_DAILY_SENDS } }] },
      ],
    }, {
      $set: {
        Email: normalise(email), OTP: code, ExpiresAt: expiresAt,
        LastSentAt: now, _updated_at: now,
        ...(tenantId ? { TenantId: tenantId } : {}),
      },
      $setOnInsert: { _created_at: now, FailedAttempts: 0, SendWindowStart: now },
      $inc: { SendCount: 1 },
      $unset: { UsedAt: '' },
    }, { upsert: true, returnDocument: 'before' });
    return { key, code, sentAt: now, previous };
  } catch (error) {
    if (error?.code === 11000) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Code request limit reached. Please try again later.');
    }
    throw error;
  }
}

// A definite relay refusal means nobody received the replacement. Restore the
// prior usable code and send allowance, but only if this send still owns the row.
// Timeouts are uncertain and must not be rolled back: the mail may have arrived.
export async function rollbackOtp(reservation) {
  if (!reservation) return;
  const { key, code, sentAt, previous } = reservation;
  const collection = await otpCollection();
  const filter = { _id: key, OTP: code, LastSentAt: sentAt };
  if (!previous) {
    await collection.deleteOne(filter);
    return;
  }
  const fields = ['OTP', 'ExpiresAt', 'LastSentAt', 'SendCount', 'TenantId', 'UsedAt'];
  const set = {};
  const unset = {};
  for (const field of fields) {
    if (Object.hasOwn(previous, field)) set[field] = previous[field];
    else unset[field] = '';
  }
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  await collection.updateOne(filter, update);
}

// Parse.Query + Parse.Object.save is read-then-write. Mongo's conditional update
// claims exactly the code that was checked; a concurrent claim or resend cannot
// redeem an old code or clear a newer one.
export async function claimOtp(email, code, now = new Date()) {
  const collection = await otpCollection();
  const claimed = await collection.findOneAndUpdate({
    _id: otpKey(email),
    Email: normalise(email),
    OTP: code,
    ExpiresAt: { $gt: now },
    $or: [{ LockedUntil: { $exists: false } }, { LockedUntil: { $lte: now } }],
  }, {
    $unset: { OTP: '' },
    $set: { UsedAt: now, FailedAttempts: 0 },
  }, { returnDocument: 'before' });
  return !!claimed;
}
