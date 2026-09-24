// Every OpenSign email goes to LeaseLynx, which archives and delivers it.
// There is no local SMTP/Mailgun fallback: a failure here is a failed send.
export class RelayError extends Error {
  constructor(message, { status = 0, uncertain = true } = {}) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

// What a 2xx from relayOpenSignEmail must say; anything else is not a confirmed send.
export const RELAY_ACCEPTED_STATUSES = Object.freeze(['submitted', 'captured', 'archive_failed']);
// Refusals that happen before LeaseLynx tries to deliver: nothing was sent.
const DEFINITE_REFUSALS = new Set([400, 403, 404]);
export const RELAY_TIMEOUT_MS = 60 * 1000;

async function idToken(fetchImpl, audience) {
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'Metadata-Flavor': 'Google' } });
  } catch (err) {
    throw new RelayError(`Could not obtain an identity token for the mail relay: ${err.message}`, { status: 0, uncertain: false });
  }
  if (!res.ok) throw new RelayError('Could not obtain an identity token for the mail relay.', { status: 0, uncertain: false });
  return (await res.text()).trim();
}

// The JSON body relayOpenSignEmail receives (functions/opensign-relay.js validateRelayMessage).
export function relayWireBody(message) {
  const list = v => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map(s => s.trim()).filter(Boolean);
  return {
    kind: message.kind || 'other', documentId: message.documentId || null, extUserId: message.extUserId || null,
    fromName: message.fromName || '', to: list(message.to), cc: list(message.cc), bcc: list(message.bcc),
    replyTo: message.replyTo || null, subject: message.subject, html: message.html || '', text: message.text || '',
    attachments: (message.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType || 'application/pdf', contentBase64: Buffer.from(a.content).toString('base64') })),
  };
}

export async function relayMail(
  message,
  { fetchImpl = fetch, relayUrl = process.env.LEASELYNX_MAIL_RELAY_URL, timeoutMs = RELAY_TIMEOUT_MS } = {}
) {
  if (!relayUrl) throw new RelayError('LEASELYNX_MAIL_RELAY_URL is not set; OpenSign sends no email without it.', { uncertain: false });
  const token = await idToken(fetchImpl, relayUrl);
  const body = relayWireBody(message);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let json;
  try {
    res = await fetchImpl(relayUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json().catch(() => ({}));
  } catch (err) {
    // A timeout or a dropped connection: LeaseLynx may have sent it.
    const reason = controller.signal.aborted ? `no answer within ${timeoutMs} ms` : err.message;
    throw new RelayError(`Mail relay unreachable: ${reason}`, { status: 0, uncertain: true });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const uncertain = DEFINITE_REFUSALS.has(res.status) ? false : res.status === 502 ? json.uncertain !== false : true;
    throw new RelayError(json.error || `Mail relay refused (${res.status})`, { status: res.status, uncertain });
  }
  if (!RELAY_ACCEPTED_STATUSES.includes(json.status)) {
    throw new RelayError(`Mail relay answered ${res.status} without a send status`, { status: res.status, uncertain: true });
  }
  return { status: 'success', logicalId: json.logicalId || null };
}

// Called once at startup: production without a relay URL sends no email at all.
export function checkMailRelayConfig(env = process.env, logger = console) {
  const production = env.NODE_ENV === 'production' || /^https:/i.test(env.SERVER_URL || '');
  if (!env.LEASELYNX_MAIL_RELAY_URL && production) {
    logger.error('[mail-relay][ALERT] LEASELYNX_MAIL_RELAY_URL is not set: OpenSign cannot send email');
    return false;
  }
  return true;
}

// Parse's password-reset and verification mail (parse-server-api-mail-adapter). The kind
// comes from the template subject: apiCallback receives only { payload, locale }.
export function parseMailKind(payload) {
  return payload?.subject?.toLowerCase().includes('password') ? 'password_reset' : 'email_verification';
}

// Parse calls the adapter without awaiting it, so a rejection here would be unhandled
// and end the process. It never rejects: a failure is an ALERT log.
export function makeApiCallback({ relay = relayMail, logger = console } = {}) {
  return async function apiCallback({ payload }) {
    const kind = parseMailKind(payload);
    try {
      await relay({ kind, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text });
    } catch (err) {
      logger.error('[mail-relay][ALERT] Parse account email failed', { kind, message: err?.message, status: err?.status ?? null });
    }
  };
}
