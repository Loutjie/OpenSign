import fs from 'node:fs';
import http from 'http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ParseServer } from 'parse-server';
import { app, config } from '../../index.js';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.resolve('databases/migrations');

// Production runs `parse-dbtool migrate` at every start (index.js), which applies these
// files' up(Parse) in filename order and stops at the first failure. They set the class
// schemas and CLPs (e.g. contracts_Template find: {}); without them the spec server has
// Parse's default all-open CLPs and a rule that only works without them passes here and
// fails in production. Same order, same stop-on-error, in process.
export async function applyProductionMigrations() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.cjs'))
    .sort();
  for (const file of files) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    try {
      await migration.up(Parse);
    } catch (err) {
      throw new Error(`migration ${file} failed in the spec harness: ${err?.message}`);
    }
  }
  return files;
}

export const dropDB = async () => {
  await Parse.User.logOut();
  return await Parse.Server.database.deleteEverything(true);
};
let parseServerState = {};

/**
 * Starts the ParseServer instance
 * @param {Object} parseServerOptions Used for creating the `ParseServer`
 * @return {Promise} Runner state
 */
export async function startParseServer() {
  delete config.databaseAdapter;
  const parseServerOptions = Object.assign(config, {
    databaseURI: process.env.MONGODB_URI
      ? `${process.env.MONGODB_URI.replace(/\/$/, '')}/parse-test`
      : 'mongodb://localhost:27017/parse-test',
    masterKey: 'test',
    javascriptKey: 'test',
    appId: 'test',
    port: 30001,
    mountPath: '/test',
    serverURL: `http://localhost:30001/test`,
    logLevel: 'error',
    silent: true,
  });
  const parseServer = new ParseServer(parseServerOptions);
  await parseServer.start();
  app.use(parseServerOptions.mountPath, parseServer.app);
  const httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(parseServerOptions.port, resolve));
  await applyProductionMigrations();
  Object.assign(parseServerState, {
    parseServer,
    httpServer,
    parseServerOptions,
  });
  return parseServerOptions;
}

/**
 * Stops the ParseServer instance
 * @return {Promise}
 */
export async function stopParseServer() {
  await new Promise(resolve => parseServerState.httpServer.close(resolve));
  parseServerState = {};
}
