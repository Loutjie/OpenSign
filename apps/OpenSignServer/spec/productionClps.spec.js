// The spec server applies databases/migrations (spec/utils/test-runner.js), so specs run
// under the class-level permissions production has. These pin the ones the security
// rules depend on; if this fails, the harness is back on Parse's open defaults.
import { rest } from './utils/rest.js';

const clpOf = async className =>
  (await rest('GET', `/schemas/${className}`, { master: true })).body?.classLevelPermissions;

describe('the spec server runs with production CLPs', () => {
  it('contracts_Template: get open, find master-only', async () => {
    const clp = await clpOf('contracts_Template');
    expect(clp?.get).toEqual({ '*': true });
    expect(clp?.find).toEqual({});
  });

  it('contracts_Document: get open, find signed-in only', async () => {
    const clp = await clpOf('contracts_Document');
    expect(clp?.get).toEqual({ '*': true });
    expect(clp?.find).toEqual({ requiresAuthentication: true });
  });

  it('contracts_Users: no client reads; anyone may create and update (guarded by beforeSave)', async () => {
    const clp = await clpOf('contracts_Users');
    expect(clp?.find).toEqual({});
    expect(clp?.get).toEqual({});
    expect(clp?.update).toEqual({ '*': true });
  });
});
