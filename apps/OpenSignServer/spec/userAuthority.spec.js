// #86 said adduser's reset of an existing account's password is admin-only. "Admin" is
// contracts_Users.UserRole of the caller's own row (addUser.js callerUserRole), and that
// class's CLP lets anyone create and update rows (20231110174122-update_setclp.cjs). These
// specs drive the chain over REST with a real session: any signed-in user (a tenant who
// logged in by OTP, say) writes themselves an admin row, then adduser sets a landlord's
// password.
import { logIn, makeUser, pointer, rest, uniq } from './utils/rest.js';
import { assertCallerTenant, makeAddUser } from '../cloud/parsefunction/addUser.js';
import { guardExtUserAuthority } from '../cloud/parsefunction/accessGuards.js';

const FORBIDDEN = 119;

describe('a signed-in user cannot make themselves an admin or take over another account', () => {
  const tag = uniq();
  let landlord;
  let tenant;
  let otherAdmin;
  let landlordExtId;
  let tenantExtId;
  const created = [];

  const masterCreate = async (className, body) => {
    const res = await rest('POST', `/classes/${className}`, { master: true, body });
    if (res.status !== 201) throw new Error(`${className}: ${JSON.stringify(res.body)}`);
    created.push([className, res.body.objectId]);
    return res.body.objectId;
  };

  const otherTenantId = `otherTenant${tag}`;
  // The admin's own organisation and team, and another tenant's (filled in beforeAll).
  const org = {};
  const team = {};
  const addUserParams = (email, password, tenantId = otherTenantId, extra = {}) => ({
    name: 'Taken Over',
    email,
    password,
    organization: { objectId: org.own },
    team: team.own,
    role: 'User',
    tenantId,
    ...extra,
  });

  beforeAll(async () => {
    org.own = await masterCreate('contracts_Organizations', {
      Name: 'Own org',
      TenantId: pointer('partners_Tenant', otherTenantId),
    });
    org.foreign = await masterCreate('contracts_Organizations', {
      Name: 'Landlord org',
      TenantId: pointer('partners_Tenant', `landlordTenant${tag}`),
    });
    team.own = await masterCreate('contracts_Teams', {
      Name: 'All Users',
      OrganizationId: pointer('contracts_Organizations', org.own),
    });
    team.foreign = await masterCreate('contracts_Teams', {
      Name: 'Landlord team',
      OrganizationId: pointer('contracts_Organizations', org.foreign),
    });
    landlord = await makeUser(`landlord-${tag}@x.test`);
    tenant = await makeUser(`tenant-${tag}@x.test`);
    otherAdmin = await makeUser(`other-admin-${tag}@x.test`);
    landlordExtId = await masterCreate('contracts_Users', {
      UserId: pointer('_User', landlord.id),
      UserRole: 'contracts_Admin',
      Email: landlord.email,
      TenantId: pointer('partners_Tenant', `landlordTenant${tag}`),
    });
    tenantExtId = await masterCreate('contracts_Users', {
      UserId: pointer('_User', tenant.id),
      UserRole: 'contracts_User',
      Email: tenant.email,
    });
    // A genuine admin of a different tenant.
    await masterCreate('contracts_Users', {
      UserId: pointer('_User', otherAdmin.id),
      UserRole: 'contracts_Admin',
      Email: otherAdmin.email,
      TenantId: pointer('partners_Tenant', otherTenantId),
    });
  });

  afterAll(async () => {
    const users = await rest('GET', `/classes/contracts_Users?where=${encodeURIComponent(JSON.stringify({ Email: { $regex: tag } }))}`, { master: true });
    for (const row of users.body?.results || []) {
      await rest('DELETE', `/classes/contracts_Users/${row.objectId}`, { master: true });
    }
    for (const [className, id] of created) await rest('DELETE', `/classes/${className}/${id}`, { master: true });
  });

  it('refuses a session creating a contracts_Users row that names itself admin', async () => {
    const res = await rest('POST', '/classes/contracts_Users', {
      session: tenant.session,
      body: { UserId: pointer('_User', tenant.id), UserRole: 'contracts_Admin', Email: tenant.email },
    });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
  });

  for (const [field, value] of [
    ['UserRole', () => 'contracts_Admin'],
    ['UserId', () => pointer('_User', landlord.id)],
    ['TenantId', () => pointer('partners_Tenant', `landlordTenant${tag}`)],
    ['Email', () => `attacker-${tag}@x.test`],
    ['OrganizationId', () => pointer('contracts_Organizations', org.foreign)],
    ['TeamIds', () => [pointer('contracts_Teams', team.foreign)]],
    ['CreatedBy', () => pointer('_User', landlord.id)],
  ]) {
    it(`refuses a session changing contracts_Users.${field} (a row with no ACL)`, async () => {
      const res = await rest('PUT', `/classes/contracts_Users/${tenantExtId}`, {
        session: tenant.session,
        body: { [field]: value() },
      });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    });
  }

  it('still lets a user save their own profile fields and tour status', async () => {
    const res = await rest('PUT', `/classes/contracts_Users/${tenantExtId}`, {
      session: tenant.session,
      body: { Name: 'Renamed', Phone: '0123', TourStatus: [{ requestSign: true }] },
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
  });

  it('keeps the landlord\'s password after the tenant tries the whole chain', async () => {
    await rest('POST', '/classes/contracts_Users', {
      session: tenant.session,
      body: { UserId: pointer('_User', tenant.id), UserRole: 'contracts_Admin', Email: tenant.email },
    });
    await rest('PUT', `/classes/contracts_Users/${tenantExtId}`, {
      session: tenant.session,
      body: { UserRole: 'contracts_Admin' },
    });
    const res = await rest('POST', '/functions/adduser', {
      session: tenant.session,
      body: addUserParams(landlord.email, `chosen-${tag}`),
    });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    expect(await logIn(landlord.email, `chosen-${tag}`)).toBeNull();
    expect(await logIn(landlord.email, landlord.password)).toBeTruthy();
  });

  // In the admin's own tenant, so only the existing-account branch can refuse it.
  it('refuses a genuine admin resetting the password of an account that already exists', async () => {
    const res = await rest('POST', '/functions/adduser', {
      session: otherAdmin.session,
      body: addUserParams(landlord.email, `admin-chosen-${tag}`),
    });
    expect(res.status).withContext(JSON.stringify(res.body)).not.toBe(200);
    expect(res.body?.error).toBe('An account with this email already exists.');
    // The Parse code is kept (USERNAME_TAKEN), not rewrapped as a 400.
    expect(res.body?.code).toBe(202);
    expect(await logIn(landlord.email, `admin-chosen-${tag}`)).toBeNull();
    expect(await logIn(landlord.email, landlord.password)).toBeTruthy();
  });

  it('refuses a genuine admin adding a new user to another tenant', async () => {
    const email = `planted-${tag}@x.test`;
    const res = await rest('POST', '/functions/adduser', {
      session: otherAdmin.session,
      body: addUserParams(email, `planted-${tag}`, `landlordTenant${tag}`),
    });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
    expect(await logIn(email, `planted-${tag}`)).toBeNull();
  });

  // Review item 4: the team and organisation must be the caller's tenant's too.
  for (const [label, extra] of [
    ['another tenant\'s team', () => ({ team: team.foreign })],
    ['another tenant\'s organisation', () => ({ organization: { objectId: org.foreign } })],
    ['a team that does not exist', () => ({ team: `noTeam${tag}` })],
    ['its own team under another tenant\'s organisation', () => ({ organization: { objectId: org.foreign }, team: team.own })],
    ['another tenant\'s team with no organisation named', () => ({ organization: {}, team: team.foreign })],
  ]) {
    it(`refuses an admin adding a user to ${label}`, async () => {
      const email = `misplaced-${uniq()}@x.test`;
      const res = await rest('POST', '/functions/adduser', {
        session: otherAdmin.session,
        body: addUserParams(email, `pw-${tag}`, otherTenantId, extra()),
      });
      expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(FORBIDDEN);
      expect(await logIn(email, `pw-${tag}`)).toBeNull();
    });
  }

  it('still lets an admin add a new user to its own team; the row is not public', async () => {
    const email = `new-member-${tag}@x.test`;
    const res = await rest('POST', '/functions/adduser', {
      session: otherAdmin.session,
      body: addUserParams(email, `member-${tag}`),
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect(res.body?.result?.UserRole).toBe('contracts_User');
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(await logIn(email, `member-${tag}`)).toBeTruthy();
    // Review item 8: the adding admin and the new user only, never public write.
    const newUserId = res.body.result.UserId.objectId;
    expect(res.body.result.ACL).toEqual({
      [otherAdmin.id]: { read: true, write: true },
      [newUserId]: { read: true, write: true },
    });
    const rename = await rest('PUT', `/classes/contracts_Users/${res.body.result.objectId}`, {
      session: tenant.session,
      body: { Name: 'Defaced', IsDisabled: true },
    });
    expect(rename.body?.code).withContext(JSON.stringify(rename.body)).toBe(101);
  });

  // Review item 7: a failed contracts_Users save leaves no login behind, and keeps its
  // Parse error code. Timezone is a String column; a number fails the master save.
  it('removes the new _User when the contracts_Users row cannot be saved', async () => {
    await masterCreate('contracts_Users', { Email: `tz-seed-${tag}@x.test`, Timezone: 'UTC' });
    const email = `orphan-${tag}@x.test`;
    const res = await rest('POST', '/functions/adduser', {
      session: otherAdmin.session,
      body: addUserParams(email, `orphan-${tag}`, otherTenantId, { timezone: 123 }),
    });
    expect(res.body?.code).withContext(JSON.stringify(res.body)).toBe(111);
    const users = await rest('GET', `/users?where=${encodeURIComponent(JSON.stringify({ email }))}`, { master: true });
    expect(users.body.results).toEqual([]);
  });
});

describe('adduser helpers', () => {
  const FORBIDDEN_CODE = 119;
  const request = params => ({ user: { id: 'admin1' }, params });

  it('assertCallerTenant refuses a caller with no row or no tenant, and a tenantId not its own', async () => {
    for (const [own, tenantId] of [[null, 't1'], [null, undefined], ['t1', 't2'], ['t1', undefined]]) {
      await expectAsync(
        assertCallerTenant(request({ tenantId }), { tenantOf: async () => own })
      ).withContext(`own=${own} tenantId=${tenantId}`).toBeRejectedWith(jasmine.objectContaining({ code: FORBIDDEN_CODE }));
    }
    await expectAsync(assertCallerTenant(request({ tenantId: 't1' }), { tenantOf: async () => 't1' })).toBeResolved();
  });

  const noChecks = { authorize: async () => {}, sameTenant: async () => {}, teamAndOrg: async () => {} };
  const params = {
    name: 'N',
    email: `helper-${uniq()}@x.test`,
    password: 'p',
    organization: {},
    team: 't',
    role: 'User',
    tenantId: 't1',
  };

  it('refuses a falsy account from createUserAccount', async () => {
    const addUser = makeAddUser({ ...noChecks, createAccount: async () => null });
    await expectAsync(addUser(request(params))).toBeRejectedWith(
      jasmine.objectContaining({ code: Parse.Error.INTERNAL_SERVER_ERROR })
    );
  });

  it('keeps a Parse error\'s code from account creation; other errors are 400', async () => {
    spyOn(console, 'log');
    const failWith = err => makeAddUser({ ...noChecks, createAccount: async () => { throw err; } });
    await expectAsync(failWith(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'bad'))(request(params))).toBeRejectedWith(
      jasmine.objectContaining({ code: Parse.Error.INVALID_EMAIL_ADDRESS })
    );
    await expectAsync(failWith(new Error('disk'))(request(params))).toBeRejectedWith(
      jasmine.objectContaining({ code: 400, message: 'disk' })
    );
  });
});

describe('guardExtUserAuthority (unit)', () => {
  const row = fields => ({ get: key => fields[key] });
  const req = (original, object) => ({ master: false, original: row(original), object: row(object) });

  it('treats unset and null as the same value', () => {
    expect(() => guardExtUserAuthority(req({}, { OrganizationId: null }))).not.toThrow();
    expect(() => guardExtUserAuthority(req({ OrganizationId: null }, {}))).not.toThrow();
  });

  it('refuses clearing or setting an authority field', () => {
    const forbidden = jasmine.objectContaining({ code: 119 });
    expect(() => guardExtUserAuthority(req({ UserRole: 'contracts_User' }, {}))).toThrow(forbidden);
    expect(() => guardExtUserAuthority(req({}, { UserRole: 'contracts_Admin' }))).toThrow(forbidden);
  });

  it('lets the master key do anything', () => {
    expect(() => guardExtUserAuthority({ master: true, object: row({ UserRole: 'x' }) })).not.toThrow();
  });
});
