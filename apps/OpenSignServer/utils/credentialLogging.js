const INSTALLED = Symbol.for('leaselynx.credentialSafeLogging');
const ENV_KEYS = [
  'MASTER_KEY', 'MONGODB_URI', 'DATABASE_URI', 'PFX_BASE64', 'PASS_PHRASE',
  'DO_ACCESS_KEY_ID', 'DO_SECRET_ACCESS_KEY', 'LEASELYNX_WEBHOOK_SECRET',
  'SMTP_PASS', 'SMTP_PASSWORD', 'GMAIL_APP_PASSWORD',
];
const PRIVATE_FIELDS = new Set([
  'password', 'passphrase', 'secret', 'token', 'authorization', 'sessiontoken',
  'accesstoken', 'refreshtoken', 'masterkey', 'xparsemasterkey',
  'xleaselynxwebhooksecret', 'pfxbase64', 'mongodburi', 'privatekey',
]);

export function sanitizeLogArgs(args, environment = process.env) {
  const values = ENV_KEYS.map(key => environment[key]).filter(value => typeof value === 'string' && value);
  for (const key of ['MONGODB_URI', 'DATABASE_URI']) {
    try {
      const password = new URL(environment[key]).password;
      if (password) values.push(password, decodeURIComponent(password));
    } catch { /* Missing or malformed configuration is never logged here. */ }
  }
  const secrets = [...new Set(values.flatMap(value => [value, encodeURIComponent(value)]))]
    .sort((a, b) => b.length - a.length);
  const text = value => {
    let result = value;
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
    return result.replace(/([?&](?:secret|password|token|x-goog-signature|x-amz-signature)=)[^&#\s'"\]]+/gi, '$1[REDACTED]');
  };
  const scrub = (value, seen, depth) => {
    if (depth > 6) return '[object omitted]';
    if (typeof value === 'string') {
      // Some callers pre-serialize their object; protect its named fields too.
      if (/^\s*[\[{]/.test(value)) {
        try { return JSON.stringify(scrub(JSON.parse(value), seen, depth + 1)); } catch { /* ordinary message */ }
      }
      return text(value);
    }
    if (!value || typeof value !== 'object') return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary omitted]';
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      // Axios configuration/request objects contain credentials and bodies.
      return scrub({ name: value.name, message: value.message, code: value.code, stack: value.stack }, seen, depth + 1);
    }
    if (Array.isArray(value)) return value.map(item => scrub(item, seen, depth + 1));
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      const privateField = PRIVATE_FIELDS.has(key.replace(/[^a-z]/gi, '').toLowerCase());
      result[text(key)] = privateField ? '[REDACTED]' : 'value' in descriptor
        ? scrub(descriptor.value, seen, depth + 1) : '[getter omitted]';
    }
    return result;
  };
  return args.map(value => scrub(value, new WeakSet(), 0));
}

export function installCredentialSafeLogging(target = console, environment = () => process.env) {
  if (target[INSTALLED]) return;
  Object.defineProperty(target, INSTALLED, { value: true });
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    if (typeof target[level] !== 'function') continue;
    const original = target[level].bind(target);
    target[level] = (...args) => {
      let safe;
      try { safe = sanitizeLogArgs(args, environment()); } catch { safe = ['[log omitted: unable to sanitize]']; }
      return original(...safe);
    };
  }
}
