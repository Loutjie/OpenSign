// #86 said adduser's reset of an existing account's password is admin-only. "Admin" is
// contracts_Users.UserRole of the caller's own row (addUser.js callerUserRole), and that
// class's CLP lets anyone create and update rows (20231110174122-update_setclp.cjs). These
// specs drive the chain over REST with a real session: any signed-in user (a tenant who
// logged in by OTP, say) writes themselves an admin row, then adduser sets a landlord's
// password.
import { logIn, makeUser, pointer, rest, uniq } from './utils/rest.js';

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
  const addUserParams = (email, password, tenantId = otherTenantId) => ({
    name: 'Taken Over',
    email,
    password,
    organization: {},
    team: `team${tag}`,
    role: 'User',
    tenantId,
  });

  beforeAll(async () => {
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

  it('still lets an admin add a new user', async () => {
    const email = `new-member-${tag}@x.test`;
    const res = await rest('POST', '/functions/adduser', {
      session: otherAdmin.session,
      body: addUserParams(email, `member-${tag}`),
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect(res.body?.result?.UserRole).toBe('contracts_User');
    expect(await logIn(email, `member-${tag}`)).toBeTruthy();
  });
});
