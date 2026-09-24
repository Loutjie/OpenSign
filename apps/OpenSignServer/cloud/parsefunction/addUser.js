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

export function makeAddUser({ authorize = assertUserAdmin } = {}) {
  return async function addUser(request) {
    await authorize(request);
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
          const extUserRes = await extUser.save();

          const parseData = JSON.parse(JSON.stringify(extUserRes));
          return parseData;
        }
      } catch (err) {
        console.log('err ', err);
        if (err.code === 202) {
          const userQuery = new Parse.Query(Parse.User);
          userQuery.equalTo('email', email);
          const userRes = await userQuery.first({ useMasterKey: true });
          userRes.setPassword(password);
          await userRes.save(null, { useMasterKey: true });
          extUser.set('CreatedBy', currentUser);
          extUser.set('UserId', { __type: 'Pointer', className: '_User', objectId: userRes.id });
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setPublicWriteAccess(true);
          acl.setReadAccess(request.user.id, true);
          acl.setWriteAccess(request.user.id, true);

          extUser.setACL(acl);
          const res = await extUser.save();

          const parseData = JSON.parse(JSON.stringify(res));
          return parseData;
        } else {
          throw new Parse.Error(400, err?.message || 'something went wrong');
        }
      }
    } catch (err) {
      console.log('err', err);
      throw new Parse.Error(400, err?.message || 'something went wrong');
    }
  } else {
    throw new Parse.Error(400, 'Please provide all required fields.');
  }
}
