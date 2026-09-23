// Every OpenSign email goes to LeaseLynx, which archives and delivers it.
// There is no local SMTP/Mailgun fallback: a failure here is a failed send.
export class RelayError extends Error {
  constructor(message, { status = 0, uncertain = true } = {}) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

async function idToken(fetchImpl, audience) {
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetchImpl(url, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new RelayError('Could not obtain an identity token for the mail relay.', { status: 0, uncertain: false });
  return (await res.text()).trim();
}

export async function relayMail(message, { fetchImpl = fetch, relayUrl = process.env.LEASELYNX_MAIL_RELAY_URL } = {}) {
  if (!relayUrl) throw new RelayError('LEASELYNX_MAIL_RELAY_URL is not set; OpenSign sends no email without it.', { uncertain: false });
  const token = await idToken(fetchImpl, relayUrl);
  const list = v => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map(s => s.trim()).filter(Boolean);
  const body = {
    kind: message.kind || 'other', documentId: message.documentId || null, extUserId: message.extUserId || null,
    fromName: message.fromName || '', to: list(message.to), cc: list(message.cc), bcc: list(message.bcc),
    replyTo: message.replyTo || null, subject: message.subject, html: message.html || '', text: message.text || '',
    attachments: (message.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType || 'application/pdf', contentBase64: Buffer.from(a.content).toString('base64') })),
  };
  let res;
  try {
    res = await fetchImpl(relayUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    throw new RelayError(`Mail relay unreachable: ${err.message}`, { status: 0, uncertain: true });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RelayError(json.error || `Mail relay refused (${res.status})`, { status: res.status, uncertain: res.status === 502 ? json.uncertain !== false : false });
  return { status: 'success', logicalId: json.logicalId || null };
}
