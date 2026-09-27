import { MongoClient } from 'mongodb';

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

// Parse.Query + Parse.Object.save is read-then-write. Mongo's conditional update
// claims exactly the code that was checked; a concurrent claim or resend cannot
// redeem an old code or clear a newer one.
export async function claimOtp(email, code, now = new Date()) {
  const collection = await otpCollection();
  const claimed = await collection.findOneAndUpdate({
    Email: email,
    OTP: code,
    ExpiresAt: { $gt: now },
    $or: [{ LockedUntil: { $exists: false } }, { LockedUntil: { $lte: now } }],
  }, {
    $unset: { OTP: '' },
    $set: { UsedAt: now, FailedAttempts: 0 },
  }, { returnDocument: 'before' });
  return !!claimed;
}
