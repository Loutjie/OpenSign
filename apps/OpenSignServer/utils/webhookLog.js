const EVENTS = new Set(['document_viewed', 'document_signed', 'document_completed', 'document_declined']);

// Webhook URLs and Axios errors can carry credentials. Log only these fields.
export function logWebhookResult(event, documentId, { failed = false, httpStatus } = {}) {
  const details = {
    event: EVENTS.has(event) ? event : 'unknown',
    documentId: typeof documentId === 'string' && /^[A-Za-z0-9]{10}$/.test(documentId) ? documentId : 'unknown',
  };
  if (failed) {
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) details.httpStatus = httpStatus;
    console.warn('[webhook] Failed', details);
  } else {
    console.info('[webhook] Delivered', details);
  }
}
