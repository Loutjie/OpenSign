import { postWebhook } from '../utils/webhookDelivery.js';

const TARGET = 'https://us-central1-leaselynx-ai.cloudfunctions.net/opensignWebhook';

describe('private LeaseLynx webhook delivery', () => {
  it('preserves an emulator-only legacy credential when a manual local server has no header secret', async () => {
    const url = 'http://localhost:7405/leaselynx-ai/us-central1/opensignWebhook?secret=dev-only';
    const requests = [];
    await postWebhook(url, {}, {secret: '', allowLocal: true, post: async (...args) => requests.push(args)});
    expect(requests).toEqual([[url, {}, {maxRedirects: 0}]]);
  });
  it('replaces the legacy URL credential with a private header and forbids redirects', async () => {
    const requests = [];
    const payload = { event: 'document_signed' };
    await postWebhook(`${TARGET}?secret=legacy-secret`, payload, {
      secret: 'replacement-secret', post: async (...args) => requests.push(args),
    });
    expect(requests).toEqual([[TARGET, payload, {
      headers: { 'X-LeaseLynx-Webhook-Secret': 'replacement-secret' }, maxRedirects: 0,
    }]]);
    expect(requests[0][0]).not.toContain('secret');
  });

  it('refuses the LeaseLynx callback without its configured secret', async () => {
    let requests = 0;
    await expectAsync(postWebhook(TARGET, {}, { secret: '', post: async () => requests++ }))
      .toBeRejectedWithError('LeaseLynx webhook credential is missing');
    expect(requests).toBe(0);
  });

  it('never attaches the shared credential to a different callback origin or path', async () => {
    const requests = [];
    for (const url of ['https://example.test/callback', `${TARGET}/other`, 'https://us-central1-leaselynx-ai.cloudfunctions.net.evil.test/opensignWebhook']) {
      await postWebhook(url, {}, { secret: 'replacement-secret', post: async (...args) => requests.push(args) });
    }
    expect(requests.every(r => r.length === 2)).toBeTrue();
    expect(JSON.stringify(requests)).not.toContain('replacement-secret');
  });

  it('allows only the hermetic loopback callback when local mode is explicitly enabled', async () => {
    const url = 'http://127.0.0.1:7405/leaselynx-ai/us-central1/opensignWebhook';
    const requests = [];
    const post = async (...args) => requests.push(args);
    await postWebhook(url, {}, { secret: 'local-secret', allowLocal: false, post });
    expect(requests[0]).toHaveSize(2);
    await postWebhook(url, {}, { secret: 'local-secret', allowLocal: true, post });
    expect(requests[1][2].headers['X-LeaseLynx-Webhook-Secret']).toBe('local-secret');
  });
});
