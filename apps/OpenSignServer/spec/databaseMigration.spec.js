import { runSchemaMigration } from '../utils/databaseMigration.js';

describe('schema migration credential handling', () => {
  it('puts the master key only in child environment and logs only a known completion marker', () => {
    const logs = [];
    let invocation;
    runSchemaMigration({
      applicationId: 'opensign', serverUrl: 'http://127.0.0.1:8080/app', masterKey: 'private-master-key',
      execute: (...args) => { invocation = args; args[3](null, 'private-master-key\nSuccessfully run migrations.', ''); },
      logger: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    });
    expect(invocation[1]).toEqual(['parse-dbtool', 'migrate']);
    expect(invocation[2].env.MASTER_KEY).toBe('private-master-key');
    expect(JSON.stringify(invocation.slice(0, 2))).not.toContain('private-master-key');
    expect(JSON.stringify(logs)).not.toContain('private-master-key');
    expect(JSON.stringify(logs)).toContain('Successfully run migrations.');
  });

  it('never logs child errors or stderr that echo credentials', () => {
    const logs = [];
    const logger = { log: (...args) => logs.push(args), error: (...args) => logs.push(args) };
    for (const error of [new Error('private-master-key'), null]) {
      runSchemaMigration({
        applicationId: 'opensign', serverUrl: 'http://127.0.0.1:8080/app', masterKey: 'private-master-key', logger,
        execute: (...args) => args[3](error, 'private-master-key', 'private-master-key'),
      });
    }
    expect(JSON.stringify(logs)).not.toContain('private-master-key');
    expect(JSON.stringify(logs)).toContain('Error:');
  });
});
