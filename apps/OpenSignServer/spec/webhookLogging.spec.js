import { logWebhookResult } from '../utils/webhookLog.js';

describe('webhook credential-safe logging', () => {
  let lines;
  beforeEach(() => {
    lines = [];
    const capture = (...args) => lines.push(JSON.stringify(args));
    spyOn(console, 'info').and.callFake(capture);
    spyOn(console, 'warn').and.callFake(capture);
  });

  it('records the delivered event and document identifier', () => {
    logWebhookResult('document_completed', 'AbCdEf1234');
    expect(lines.join(' ')).toContain('document_completed');
    expect(lines.join(' ')).toContain('AbCdEf1234');
    expect(lines.join(' ')).toContain('Delivered');
  });

  it('records HTTP failure status without the credential-bearing error or request', () => {
    const url = 'https://example.test/webhook?secret=must-not-appear';
    logWebhookResult('document_signed', 'AbCdEf1234', {
      failed: true, httpStatus: 401,
      error: Object.assign(new Error(url), { config: { url }, response: { data: url } }),
    });
    expect(lines.join(' ')).toContain('401');
    expect(lines.join(' ')).toContain('Failed');
    expect(lines.join(' ')).not.toContain('must-not-appear');
    expect(lines.join(' ')).not.toContain('https://');
  });

  it('drops unexpected identifiers and nonnumeric status values', () => {
    const secret = 'https://example.test/?secret=must-not-appear';
    logWebhookResult(secret, secret, { failed: true, httpStatus: secret });
    expect(lines.join(' ')).not.toContain('must-not-appear');
    expect(lines.join(' ')).toContain('unknown');
  });
});
