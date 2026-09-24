// spec/mainRegistrations.spec.js
// Loads the real cloud/main.js with Parse.Cloud's registration calls recorded, so the
// guards are proved registered, not just written.
import ParseSDK from 'parse/node';
import { rejectSelfSignup, requireMasterKey } from '../cloud/parsefunction/accessGuards.js';

globalThis.Parse ??= ParseSDK;

describe('cloud/main.js registrations', () => {
  const calls = [];
  beforeAll(async () => {
    const saved = { ...Parse.Cloud };
    for (const kind of ['define', 'job', 'beforeSave', 'afterSave', 'beforeFind', 'afterFind', 'beforeDelete', 'afterDelete', 'beforeLogin', 'afterLogout']) {
      Parse.Cloud[kind] = (target, fn) => calls.push({ kind, target: target?.className || target, fn });
    }
    try {
      await import('../cloud/main.js');
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
