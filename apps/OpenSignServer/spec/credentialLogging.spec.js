import { sanitizeLogArgs, installCredentialSafeLogging } from '../utils/credentialLogging.js';

describe('credential-safe server logging', () => {
  const environment = {
    MASTER_KEY: 'private-master-key', LEASELYNX_WEBHOOK_SECRET: 'private-webhook-key',
    MONGODB_URI: 'mongodb+srv://user:private%40database@cluster.example/db',
  };

  it('removes configured credentials, including decoded database passwords, from messages', () => {
    const output = JSON.stringify(sanitizeLogArgs([
      'private-master-key private-webhook-key private@database',
      environment.MONGODB_URI,
    ], environment));
    for (const secret of ['private-master-key', 'private-webhook-key', 'private@database', environment.MONGODB_URI]) {
      expect(output).not.toContain(secret);
    }
  });

  it('drops Axios request configuration and protects credentials in error messages', () => {
    const error = Object.assign(new Error('failed for private-master-key'), {
      config: { headers: { 'X-Parse-Master-Key': 'private-master-key' }, data: 'unknown-private-body' }, code: 'ERR_BAD_RESPONSE',
    });
    const output = JSON.stringify(sanitizeLogArgs([error], environment));
    expect(output).not.toContain('private-master-key');
    expect(output).not.toContain('unknown-private-body');
    expect(output).toContain('ERR_BAD_RESPONSE');
  });

  it('redacts password and token fields without mutating the input', () => {
    const input = { user: { password: 'new-admin-password', sessionToken: 'user-token' }, status: 401 };
    const output = JSON.stringify(sanitizeLogArgs([input, JSON.stringify(input)], {}));
    expect(output).not.toContain('new-admin-password');
    expect(output).not.toContain('user-token');
    expect(output).toContain('401');
    expect(input.user.password).toBe('new-admin-password');
  });

  it('omits binary data and masks credential-bearing URL queries', () => {
    const output = JSON.stringify(sanitizeLogArgs([
      Buffer.from('private-key-material'),
      'https://example.test/hook?secret=legacy-key&token=session-token',
    ], {}));
    expect(output).not.toContain('legacy-key');
    expect(output).not.toContain('session-token');
    expect(output).toContain('binary omitted');
  });

  it('wraps console methods once and reads the current environment on each call', () => {
    const calls = [];
    const target = { log: (...args) => calls.push(args) };
    const env = { MASTER_KEY: 'first-private-key' };
    installCredentialSafeLogging(target, () => env);
    installCredentialSafeLogging(target, () => env);
    target.log('first-private-key');
    env.MASTER_KEY = 'replacement-private-key';
    target.log({ 'X-Parse-Master-Key': 'replacement-private-key', event: 'document_signed' });
    expect(calls).toHaveSize(2);
    expect(JSON.stringify(calls)).not.toContain('first-private-key');
    expect(JSON.stringify(calls)).not.toContain('replacement-private-key');
    expect(JSON.stringify(calls)).toContain('document_signed');
  });

  it('omits a log if sanitizing it fails rather than printing raw arguments or breaking the caller', () => {
    const calls = [];
    const target = { log: (...args) => calls.push(args) };
    installCredentialSafeLogging(target, () => { throw new Error('private-master-key'); });
    expect(() => target.log('private-master-key')).not.toThrow();
    expect(JSON.stringify(calls)).not.toContain('private-master-key');
    expect(JSON.stringify(calls)).toContain('log omitted');
  });
});
