// spec/leaselynxRelay.spec.js
import { relayMail } from '../leaselynxRelay.js';

const msg = { kind: 'document', documentId: 'd1', extUserId: 'e1', fromName: 'Ada', to: ['t@x.test'],
  subject: 'S', html: '<p>h</p>', text: 't', attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }] };

describe('relayMail', () => {
  it('posts the wire format with a metadata-server ID token', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      if (url.startsWith('http://metadata.google.internal')) return { ok: true, text: async () => 'ID.TOKEN' };
      return { ok: true, status: 200, json: async () => ({ status: 'submitted', logicalId: 'L1' }) };
    };
    const res = await relayMail(msg, { fetchImpl, relayUrl: 'https://relay.example/relayOpenSignEmail' });
    expect(res).toEqual({ status: 'success', logicalId: 'L1' });
    expect(calls[0].url).toContain('audience=https%3A%2F%2Frelay.example%2FrelayOpenSignEmail');
    expect(calls[0].opts.headers['Metadata-Flavor']).toBe('Google');
    const body = JSON.parse(calls[1].opts.body);
    expect(calls[1].opts.headers.Authorization).toBe('Bearer ID.TOKEN');
    expect(body.attachments[0].contentBase64).toBe(Buffer.from('%PDF').toString('base64'));
    expect(body.to).toEqual(['t@x.test']);
  });
  it('fails closed without a relay URL', async () => {
    await expectAsync(relayMail(msg, { fetchImpl: async () => { throw new Error('no'); }, relayUrl: '' }))
      .toBeRejectedWithError(/LEASELYNX_MAIL_RELAY_URL/);
  });
  it('throws with uncertain for a 502 uncertain response', async () => {
    const fetchImpl = async (url) => url.startsWith('http://metadata') ? { ok: true, text: async () => 'T' }
      : { ok: false, status: 502, json: async () => ({ error: 'x', uncertain: true }) };
    await expectAsync(relayMail(msg, { fetchImpl, relayUrl: 'https://r' })).toBeRejectedWith(jasmine.objectContaining({ status: 502, uncertain: true }));
  });
});
