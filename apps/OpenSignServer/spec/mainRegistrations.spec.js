// spec/mainRegistrations.spec.js
// Re-import the entry module with a fresh URL so its top-level registrations run
// even when ParseServer has already loaded main.js during test setup.
import ParseSDK from 'parse/node';
import { config } from '../index.js';
import { rejectSelfSignup, requireMasterKey } from '../cloud/parsefunction/accessGuards.js';

globalThis.Parse ??= ParseSDK;

describe('cloud/main.js registrations', () => {
  it('awaits Cloud Code registration before Parse Server finishes startup', async () => {
    const startup = config.cloud();
    expect(startup?.then).toEqual(jasmine.any(Function));
    await startup;
  });

  const calls = [];
  beforeAll(async () => {
    const saved = { ...Parse.Cloud };
    for (const kind of ['define', 'job', 'beforeSave', 'afterSave', 'beforeFind', 'afterFind', 'beforeDelete', 'afterDelete', 'beforeLogin', 'afterLogout']) {
      Parse.Cloud[kind] = (target, fn) => calls.push({ kind, target: target?.className || target, fn });
    }
    try {
      await import(new URL(`../cloud/main.js?registration-test=${Date.now()}`, import.meta.url));
    } finally {
      Object.assign(Parse.Cloud, saved);
    }
  });

  it('refuses self-signup: beforeSave on _User is rejectSelfSignup', () => {
    expect(calls).toContain({ kind: 'beforeSave', target: '_User', fn: rejectSelfSignup });
  });

  it('makes defaultdata_Otp and MailRateLimit master-key only', () => {
    for (const target of ['defaultdata_Otp', 'MailRateLimit']) {
      for (const kind of ['beforeFind', 'beforeSave', 'beforeDelete']) {
        expect(calls).withContext(`${kind} ${target}`).toContain({ kind, target, fn: requireMasterKey });
      }
    }
  });
});
