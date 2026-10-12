import { execFile } from 'node:child_process';

const SUCCESS = [
  'Successfully run migrations.',
  'No migrations were executed, database schema was already up to date.',
];

export function runSchemaMigration({ applicationId, serverUrl, masterKey, execute = execFile, logger = console }) {
  return execute(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['parse-dbtool', 'migrate'], {
    env: { ...process.env, APPLICATION_ID: applicationId, SERVER_URL: serverUrl, MASTER_KEY: masterKey },
    shell: process.platform === 'win32',
  }, (error, stdout, stderr) => {
    const marker = SUCCESS.find(value => stdout?.includes(value));
    if (error || stderr || !marker) {
      logger.error('Error: database schema migration command failed.');
      return;
    }
    // Child errors/stdout can echo credentials. Preserve only a known marker.
    logger.log(`Command output: ${marker}`);
  });
}
