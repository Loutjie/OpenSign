import axios from 'axios';

const LEASELYNX_ORIGIN = 'https://us-central1-leaselynx-ai.cloudfunctions.net';

export async function postWebhook(url, payload, {
  post = axios.post,
  secret = process.env.LEASELYNX_WEBHOOK_SECRET,
  allowLocal = process.env.USE_LOCAL === 'true' && process.env.NODE_ENV !== 'production',
} = {}) {
  const target = new URL(url);
  const production = target.origin === LEASELYNX_ORIGIN && target.pathname === '/opensignWebhook';
  const local = allowLocal && target.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(target.hostname) &&
    target.pathname === '/leaselynx-ai/us-central1/opensignWebhook';
  if (!production && !local) return post(url, payload);
  if (typeof secret !== 'string' || !secret.trim()) throw new Error('LeaseLynx webhook credential is missing');
  target.searchParams.delete('secret');
  return post(target.toString(), payload, {
    headers: { 'X-LeaseLynx-Webhook-Secret': secret.trim() }, maxRedirects: 0,
  });
}
