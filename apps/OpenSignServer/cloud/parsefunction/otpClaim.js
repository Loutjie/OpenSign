import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';

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

// _id is unique by construction, including for concurrent first sends. Older
// random-ID OTP rows are left alone and expire; all new readers use this key.
export async function storeOtp(email, code, tenantId, expiresAt) {
  const collection = await otpCollection();
  const now = new Date();
  await collection.updateOne({ _id: otpKey(email) }, {
    $set: {
      Email: normalise(email), OTP: code, ExpiresAt: expiresAt,
      FailedAttempts: 0, _updated_at: now,
      ...(tenantId ? { TenantId: tenantId } : {}),
    },
    $setOnInsert: { _created_at: now },
    $unset: { UsedAt: '' },
  }, { upsert: true });
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
