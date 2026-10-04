import { createUserAccount } from './userAccount.js';

// Roles that manage an organisation's users (as in resetPassword.js).
export const USER_ADMIN_ROLES = Object.freeze(['contracts_Admin', 'contracts_OrgAdmin']);

const idOf = value => (value && (value.id || value.objectId)) || null;

const forbid = message => {
  throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
};

export async function callerUserRole(
  user,
  { query = () => new Parse.Query('contracts_Users') } = {}
) {
  const extUser = await query()
    .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id })
    .first({ useMasterKey: true });
  return extUser?.get('UserRole');
}

// adduser makes a login with a chosen password, so only an admin may call it. Otherwise
// any signed-in user could mint logins, each with its own daily mail limit.
export async function assertUserAdmin(request, { callerRole = callerUserRole } = {}) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }
  const role = await callerRole(request.user);
  if (!USER_ADMIN_ROLES.includes(role)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Only an admin can add users.');
  }
}

export async function callerTenantId(
  user,
  { query = () => new Parse.Query('contracts_Users') } = {}
) {
  const extUser = await query()
    .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id })
    .first({ useMasterKey: true });
  return extUser?.get('TenantId')?.id || null;
}

// An admin adds users to their own tenant only (#86): otherwise an admin of one tenant
// could put an account it controls into another.
export async function assertCallerTenant(request, { tenantOf = callerTenantId } = {}) {
  const own = await tenantOf(request.user);
  if (!own || request.params?.tenantId !== own) {
    forbid('You can only add users to your own organisation.');
  }
}

const getById = (className, id) =>
  typeof id === 'string' && id
    ? new Parse.Query(className).equalTo('objectId', id).first({ useMasterKey: true })
    : Promise.resolve(undefined);

// The team (and organisation, when given) the new user joins must be the caller's
// tenant's: a contracts_Teams row whose OrganizationId is that organisation, and a
// contracts_Organizations row whose TenantId is the caller's tenant (already checked by
// assertCallerTenant). The client sends its own OrganizationId and a team from getteams.
export async function assertTeamAndOrg(request, { lookup = getById } = {}) {
  const tenantId = request.params?.tenantId;
  const orgId = request.params?.organization?.objectId;
  const inTenant = org => !!org && idOf(org.get('TenantId')) === tenantId;
  if (orgId && !inTenant(await lookup('contracts_Organizations', orgId))) {
    forbid('That organisation is not yours.');
  }
  const team = await lookup('contracts_Teams', request.params?.team);
  if (!team) forbid('That team is not yours.');
  const teamOrgId = idOf(team.get('OrganizationId'));
  const teamOk = orgId
    ? teamOrgId === orgId
    : !!teamOrgId && inTenant(await lookup('contracts_Organizations', teamOrgId));
  if (!teamOk) forbid('That team is not yours.');
}

export function makeAddUser({
  authorize = assertUserAdmin,
  sameTenant = assertCallerTenant,
  teamAndOrg = assertTeamAndOrg,
  createAccount = fields => createUserAccount(fields),
} = {}) {
  return async function addUser(request) {
    await authorize(request);
    await sameTenant(request);
    await teamAndOrg(request);
    return addAuthorizedUser(request, createAccount);
  };
}

export default makeAddUser();

// Parse errors keep their own code; anything else is a 400 with its message.
const asParseError = err =>
  err instanceof Parse.Error || Number.isInteger(err?.code)
    ? new Parse.Error(err.code, err.message)
    : new Parse.Error(400, err?.message || 'something went wrong');

async function addAuthorizedUser(request, createAccount) {
  const { phone, name, password, organization, team, tenantId, timezone, role } = request.params;
  const email = request.params?.email?.toLowerCase()?.replace(/\s/g, '');
  const currentUser = { __type: 'Pointer', className: '_User', objectId: request.user.id };
  if (!(name && email && password && organization && team && role && tenantId)) {
    throw new Parse.Error(400, 'Please provide all required fields.');
  }
  const extUser = new Parse.Object('contracts_Users');
  extUser.set('Name', name);
  if (phone) extUser.set('Phone', phone);
  extUser.set('Email', email);
  extUser.set('UserRole', `contracts_${role}`);
  extUser.set('TeamIds', [{ __type: 'Pointer', className: 'contracts_Teams', objectId: team }]);
  if (organization.objectId) {
    extUser.set('OrganizationId', {
      __type: 'Pointer',
      className: 'contracts_Organizations',
      objectId: organization.objectId,
    });
  }
  if (organization.company) extUser.set('Company', organization.company);
  extUser.set('TenantId', { __type: 'Pointer', className: 'partners_Tenant', objectId: tenantId });
  if (timezone) extUser.set('Timezone', timezone);

  let user;
  try {
    user = await createAccount({ name, email, phone, password });
  } catch (err) {
    console.log('adduser: account not created', { message: err?.message, code: err?.code });
    // 202: the email already has an account. This used to set that account's password
    // to the one the caller chose, whoever's account it was (#86): a takeover of any
    // landlord or tenant by any admin, and every LeaseLynx landlord is an admin.
    if (err?.code === Parse.Error.USERNAME_TAKEN) {
      throw new Parse.Error(
        Parse.Error.USERNAME_TAKEN,
        'An account with this email already exists.'
      );
    }
    throw asParseError(err);
  }
  if (!user?.id) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'The account could not be created.');
  }

  extUser.set('CreatedBy', currentUser);
  extUser.set('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
  // The admin who added the user, and the user itself (profile, tour status), can write
  // the row; nobody else. It used to be public read/write. The authority fields are
  // server-set regardless (accessGuards.js guardExtUserAuthority).
  const acl = new Parse.ACL();
  for (const id of [request.user.id, user.id]) {
    acl.setReadAccess(id, true);
    acl.setWriteAccess(id, true);
  }
  extUser.setACL(acl);
  try {
    // Master key: guardExtUserAuthority refuses client-side creates of this class.
    const extUserRes = await extUser.save(null, { useMasterKey: true });
    return JSON.parse(JSON.stringify(extUserRes));
  } catch (err) {
    // Do not leave a login with no contracts_Users row behind.
    console.log('adduser: contracts_Users row not saved; removing the new account', {
      message: err?.message,
      code: err?.code,
    });
    try {
      await Parse.User.createWithoutData(user.id).destroy({ useMasterKey: true });
    } catch (cleanupErr) {
      console.error('[adduser] could not remove the orphaned _User', {
        userId: user.id,
        message: cleanupErr?.message,
      });
    }
    throw asParseError(err);
  }
}
