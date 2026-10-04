import { createUserAccount } from './userAccount.js';

// Roles that manage an organisation's users (as in resetPassword.js).
export const USER_ADMIN_ROLES = Object.freeze(['contracts_Admin', 'contracts_OrgAdmin']);

export async function callerUserRole(
  user,
  { query = () => new Parse.Query('contracts_Users') } = {}
) {
  const extUser = await query()
    .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id })
    .first({ useMasterKey: true });
  return extUser?.get('UserRole');
}

// adduser makes a login with a chosen password (and, for an email that already has an
// account, sets that account's password), so only an admin may call it. Otherwise any
// signed-in user could mint logins, each with its own daily mail limit, or take over an
// existing account.
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
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'You can only add users to your own organisation.'
    );
  }
}

export function makeAddUser({ authorize = assertUserAdmin, sameTenant = assertCallerTenant } = {}) {
  return async function addUser(request) {
    await authorize(request);
    await sameTenant(request);
    return addAuthorizedUser(request);
  };
}

export default makeAddUser();

async function addAuthorizedUser(request) {
  const { phone, name, password, organization, team, tenantId, timezone, role } = request.params;
  const email = request.params?.email?.toLowerCase()?.replace(/\s/g, '');
  const currentUser = { __type: 'Pointer', className: '_User', objectId: request.user.id };
  if (name && email && password && organization && team && role && tenantId) {
    try {
      const extUser = new Parse.Object('contracts_Users');
      extUser.set('Name', name);
      if (phone) {
        extUser.set('Phone', phone);
      }
      extUser.set('Email', email);
      extUser.set('UserRole', `contracts_${role}`);
      if (team) {
        extUser.set('TeamIds', [
          {
            __type: 'Pointer',
            className: 'contracts_Teams',
            objectId: team,
          },
        ]);
      }
      if (organization.objectId) {
        extUser.set('OrganizationId', {
          __type: 'Pointer',
          className: 'contracts_Organizations',
          objectId: organization.objectId,
        });
      }
      if (organization.company) {
        extUser.set('Company', organization.company);
      }

      if (tenantId) {
        extUser.set('TenantId', {
          __type: 'Pointer',
          className: 'partners_Tenant',
          objectId: tenantId,
        });
      }
      if (timezone) {
        extUser.set('Timezone', timezone);
      }
      try {
        const user = await createUserAccount({ name, email, phone, password });
        if (user) {
          extUser.set('CreatedBy', currentUser);

          extUser.set('UserId', user);
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setPublicWriteAccess(true);
          acl.setReadAccess(request.user.id, true);
          acl.setWriteAccess(request.user.id, true);
          extUser.setACL(acl);
          // Master key: guardExtUserAuthority refuses client-side creates of this class.
          const extUserRes = await extUser.save(null, { useMasterKey: true });

          const parseData = JSON.parse(JSON.stringify(extUserRes));
          return parseData;
        }
      } catch (err) {
        console.log('err ', err);
        // 202: the email already has an account. This used to set that account's password
        // to the one the caller chose, whoever's account it was (#86): a takeover of any
        // landlord or tenant by any admin, and every LeaseLynx landlord is an admin.
        if (err.code === 202) {
          throw new Parse.Error(
            Parse.Error.USERNAME_TAKEN,
            'An account with this email already exists.'
          );
        }
        throw new Parse.Error(400, err?.message || 'something went wrong');
      }
    } catch (err) {
      console.log('err', err);
      throw new Parse.Error(400, err?.message || 'something went wrong');
    }
  } else {
    throw new Parse.Error(400, 'Please provide all required fields.');
  }
}
