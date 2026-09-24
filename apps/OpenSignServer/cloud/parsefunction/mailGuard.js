// What a signed-in user (not the master key) may email through sendmailv3 and forwarddoc:
// only a document they created or sign, only to that document's signers or owner, and at
// most DAILY_RECIPIENT_LIMIT recipients a day. The master key (LeaseLynx, OpenSign's own
// server-side senders) is not limited here.

export const DAILY_RECIPIENT_LIMIT = 50;

export const normaliseEmail = email =>
  String(email || '')
    .toLowerCase()
    .replace(/\s/g, '');

// Every address in `values` (arrays or comma-separated strings), normalised.
export function recipientList(...values) {
  return values
    .flatMap(v => (Array.isArray(v) ? v : v ? String(v).split(',') : []))
    .map(normaliseEmail)
    .filter(Boolean);
}

// `user` is a Parse.User (req.user, or the user of a session) or its JSON.
export function callerIdentity(user) {
  if (!user) return null;
  const get = key => (typeof user.get === 'function' ? user.get(key) : user[key]);
  return { id: user.id || user.objectId || null, email: normaliseEmail(get('email') || get('username')) };
}

export async function loadMailDocument(
  documentId,
  { query = () => new Parse.Query('contracts_Document') } = {}
) {
  if (!documentId || typeof documentId !== 'string') return null;
  const q = query();
  q.equalTo('objectId', documentId);
  q.include('Signers');
  q.include('ExtUserPtr');
  q.include('CreatedBy');
  const doc = await q.first({ useMasterKey: true });
  return doc ? doc.toJSON() : null;
}

function forbid(message) {
  throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
}

// Throws OPERATION_FORBIDDEN unless `caller` created `doc` or is one of its signers, and
// every recipient is a signer of `doc` or its owner.
export function assertDocumentMailAllowed(doc, caller, recipients) {
  if (!doc) forbid('Email refused: document not found.');
  if (!caller?.id) forbid('Permission denied.');
  const signers = doc.Signers || [];
  const signerEmails = [
    ...signers.map(s => s?.Email),
    ...(doc.Placeholders || []).map(p => p?.email),
  ]
    .map(normaliseEmail)
    .filter(Boolean);
  const ownerEmails = [doc.ExtUserPtr?.Email, doc.CreatedBy?.email, doc.CreatedBy?.username]
    .map(normaliseEmail)
    .filter(Boolean);

  const isCreator = doc.CreatedBy?.objectId === caller.id;
  const isSigner =
    signers.some(s => s?.UserId?.objectId === caller.id) ||
    (!!caller.email && signerEmails.includes(caller.email));
  if (!isCreator && !isSigner) forbid('Email refused: you are not a party to this document.');

  if (!recipients?.length) forbid('Email refused: no recipient.');
  const allowed = new Set([...signerEmails, ...ownerEmails]);
  if (!recipients.every(r => allowed.has(r))) {
    forbid('Email refused: every recipient must be a signer or the owner of this document.');
  }
}

// Loads `documentId` and checks it for `caller` and `recipients`; returns the document.
export async function authorizeDocumentMail(
  { documentId, caller, recipients },
  { loadDocument = loadMailDocument } = {}
) {
  if (!documentId) forbid('Email refused: a documentId is required.');
  const doc = await loadDocument(documentId);
  assertDocumentMailAllowed(doc, caller, recipients);
  return doc;
}

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

// MailRateLimit {userId, day, count}. `increment` is an atomic $inc, so concurrent sends
// cannot lose counts. Two first sends of a day can race to create two rows for the same
// user and day, so the total is read across every matching row.
export function parseMailCounter({
  query = () => new Parse.Query('MailRateLimit'),
  create = () => new Parse.Object('MailRateLimit'),
} = {}) {
  const rowsFor = (userId, day) => query().equalTo('userId', userId).equalTo('day', day);
  return {
    async add(userId, day, amount) {
      const existing = await rowsFor(userId, day).first({ useMasterKey: true });
      const row = existing || create();
      if (!existing) {
        row.set('userId', userId);
        row.set('day', day);
      }
      row.increment('count', amount);
      await row.save(null, { useMasterKey: true });
      const rows = await rowsFor(userId, day).find({ useMasterKey: true });
      return rows.reduce((sum, r) => sum + (Number(r.get('count')) || 0), 0);
    },
  };
}

// Counts `recipients` against the user's daily limit before anything is relayed. A send
// that would go over the limit is refused and not counted.
export function makeMailQuota({
  counter = parseMailCounter(),
  limit = DAILY_RECIPIENT_LIMIT,
  now = () => new Date(),
  logger = console,
} = {}) {
  return async function consumeMailQuota(userId, recipients) {
    const day = utcDay(now());
    const total = await counter.add(userId, day, recipients);
    if (total > limit) {
      try {
        await counter.add(userId, day, -recipients);
      } catch (err) {
        // Only over-counts (a stricter limit today); log it, the refusal stands.
        logger.error('[mail-limit] could not uncount a refused send', { userId, day, message: err?.message });
      }
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Daily email limit reached');
    }
    return total;
  };
}
