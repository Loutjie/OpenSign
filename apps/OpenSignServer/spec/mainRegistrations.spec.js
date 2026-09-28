// spec/mainRegistrations.spec.js
// Re-import the entry module with a fresh URL so its top-level registrations run
// even when ParseServer has already loaded main.js during test setup.
import ParseSDK from 'parse/node';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rejectSelfSignup, requireMasterKey } from '../cloud/parsefunction/accessGuards.js';

globalThis.Parse ??= ParseSDK;
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('cloud/main.js registrations', () => {
  it('registers Cloud Code before the startup callback resolves in a fresh process', () => {
    const script = `
      import ParseSDK from 'parse/node';
      globalThis.Parse = ParseSDK;
      const { config } = await import('./index.js');
      const registrations = [];
      const originalDefine = Parse.Cloud.define;
      Parse.Cloud.define = (name, ...args) => {
        registrations.push(name);
        return originalDefine.call(Parse.Cloud, name, ...args);
      };
      await config.cloud();
      if (!registrations.includes('SendOTPMailV1')) process.exitCode = 2;
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: serverDir,
      env: { ...process.env, TESTING: 'true', USE_LOCAL: 'true' },
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).withContext(result.stderr).toBe(0);
  });

  it('exits nonzero when Parse Server startup fails', () => {
    const env = {
      ...process.env,
      USE_LOCAL: 'true',
      SERVER_URL: 'http://localhost:8080/app',
    };
    delete env.TESTING;
    delete env.MASTER_KEY;
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: serverDir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FATAL: Parse Server failed to start.');
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
