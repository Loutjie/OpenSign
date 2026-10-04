// #86: senddeleterequest found its target with Parse.Query.or(UserId = userId,
// UserId = userId AND CreatedBy = caller); the first branch alone matched any account, so
// any signed-in user could have the account-deletion mail sent to any admin. These specs
// run the real lookup against the spec Mongo.
import { makeSendDeleteUserMail } from '../cloud/parsefunction/sendDeleteUserMail.js';
import { pointer, uniq } from './utils/rest.js';

describe('senddeleterequest is for the caller\'s own account', () => {
  const tag = uniq();
  const ids = {
    adminA: `adminA${tag}`,
    adminB: `adminB${tag}`,
    caller: `caller${tag}`,
  };
  const rows = [];

  const extUser = async ({ userId, role, email, createdBy }) => {
    const row = new Parse.Object('contracts_Users');
    row.set('UserId', pointer('_User', userId));
    row.set('UserRole', role);
    row.set('Email', email);
    row.set('Name', email.split('@')[0]);
    if (createdBy) row.set('CreatedBy', pointer('_User', createdBy));
    await row.save(null, { useMasterKey: true });
    rows.push(row);
  };

  const sender = () => {
    const calls = [];
    const send = makeSendDeleteUserMail({
      relay: async message => {
        calls.push(message);
        return { status: 'success', logicalId: 'L1' };
      },
    });
    return { calls, send };
  };

  const outcome = async promise => {
    try {
      return { result: await promise };
    } catch (error) {
      return { error };
    }
  };

  beforeAll(async () => {
    await extUser({ userId: ids.adminA, role: 'contracts_Admin', email: `admin-a-${tag}@x.test` });
    // Another tenant's admin, created by someone else: nothing links it to the caller.
    await extUser({ userId: ids.adminB, role: 'contracts_Admin', email: `admin-b-${tag}@x.test` });
    await extUser({ userId: ids.caller, role: 'contracts_User', email: `caller-${tag}@x.test` });
  });

  afterAll(async () => {
    await Parse.Object.destroyAll(rows, { useMasterKey: true });
  });

  it('refuses to mail another tenant\'s admin, and relays nothing', async () => {
    spyOn(console, 'log');
    const { calls, send } = sender();
    const { result, error } = await outcome(send({ user: { id: ids.caller }, params: { userId: ids.adminB } }));
    expect(result).toBeUndefined();
    expect(error?.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    expect(calls).toEqual([]);
  });

  it('refuses an admin naming another admin\'s account too', async () => {
    spyOn(console, 'log');
    const { calls, send } = sender();
    const { error } = await outcome(send({ user: { id: ids.adminA }, params: { userId: ids.adminB } }));
    expect(error?.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    expect(calls).toEqual([]);
  });

  it('refuses no session (209) and a missing userId (102), relaying nothing', async () => {
    const { calls, send } = sender();
    let { error } = await outcome(send({ params: { userId: ids.adminA } }));
    expect(error?.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    ({ error } = await outcome(send({ user: { id: ids.adminA }, params: {} })));
    expect(error?.code).toBe(Parse.Error.INVALID_QUERY);
    expect(calls).toEqual([]);
  });

  it('answers OBJECT_NOT_FOUND for a caller with no contracts_Users row', async () => {
    spyOn(console, 'log');
    const { calls, send } = sender();
    const noRow = `noRow${tag}`;
    const { error } = await outcome(send({ user: { id: noRow }, params: { userId: noRow } }));
    expect(error?.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error?.message).toBe('Account not found.');
    expect(calls).toEqual([]);
  });

  it('mails an admin\'s own request to that admin\'s own address', async () => {
    const { calls, send } = sender();
    const { result } = await outcome(send({ user: { id: ids.adminA }, params: { userId: ids.adminA } }));
    expect(result).toBe('mail sent.');
    expect(calls.length).toBe(1);
    expect(calls[0].to).toBe(`admin-a-${tag}@x.test`);
    expect(calls[0].kind).toBe('delete_request');
  });
});
