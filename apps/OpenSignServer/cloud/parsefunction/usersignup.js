import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;

async function findUserByUsername(username) {
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('username', username);
  return userQuery.first({ useMasterKey: true });
}

// The _User beforeSave trigger (accessGuards.js) refuses a new user without the master
// key, so the signUp here must carry it.
export async function saveUser(
  userDetails,
  { findUser = findUserByUsername, newUser = () => new Parse.User() } = {}
) {
  const userRes = await findUser(userDetails.email);

  if (userRes) {
    const url = `${serverUrl}/loginAs`;
    const axiosRes = await axios({
      method: 'POST',
      url: url,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': APPID,
        'X-Parse-Master-Key': masterKEY,
      },
      params: {
        userId: userRes.id,
      },
    });
    const login = await axiosRes.data;
    // console.log("login ", login);
    return { id: login.objectId, sessionToken: login.sessionToken };
  } else {
    const user = newUser();
    user.set('username', userDetails.email);
    user.set('password', userDetails.password);
    user.set('email', userDetails?.email?.toLowerCase()?.replace(/\s/g, ''));
    if (userDetails?.phone) {
      user.set('phone', userDetails.phone);
    }
    user.set('name', userDetails.name);

    const res = await user.signUp(null, { useMasterKey: true });
    // console.log("res ", res);
    return { id: res.id, sessionToken: res.getSessionToken() };
  }
}

// Only the master key may create accounts. Anyone else could sign up, get a session
// and use it to send mail through sendmailv3; or, for an existing user without a
// contracts_Users row, get that user's session from the loginAs branch of saveUser.
export function makeUsersignup({ createAccount = createAccountAndProfile } = {}) {
  return async function usersignup(request) {
    if (!request?.master) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Sign-up is closed.');
    }
    return createAccount(request.params.userDetails);
  };
}

export default makeUsersignup();

async function createAccountAndProfile(userDetails) {
  try {
    const user = await saveUser(userDetails);
    const extClass = userDetails.role.split('_')[0];

    const extQuery = new Parse.Query(extClass + '_Users');
    extQuery.equalTo('UserId', {
      __type: 'Pointer',
      className: '_User',
      objectId: user.id,
    });
    const extUser = await extQuery.first({ useMasterKey: true });
    if (extUser) {
      return { message: 'User already exist' };
    } else {
      // console.log("role ", role);
      const partnerCls = Parse.Object.extend('partners_Tenant');
      const partnerQuery = new partnerCls();
      partnerQuery.set('UserId', {
        __type: 'Pointer',
        className: '_User',
        objectId: user.id,
      });

      if (userDetails?.phone) {
        partnerQuery.set('ContactNumber', userDetails.phone);
      }
      partnerQuery.set('TenantName', userDetails.company);
      partnerQuery.set('EmailAddress', userDetails?.email?.toLowerCase()?.replace(/\s/g, ''));
      partnerQuery.set('IsActive', true);
      partnerQuery.set('CreatedBy', {
        __type: 'Pointer',
        className: '_User',
        objectId: user.id,
      });
      if (userDetails && userDetails.pincode) {
        partnerQuery.set('PinCode', userDetails.pincode);
      }
      if (userDetails && userDetails.country) {
        partnerQuery.set('Country', userDetails.country);
      }
      if (userDetails && userDetails.state) {
        partnerQuery.set('State', userDetails.state);
      }
      if (userDetails && userDetails.city) {
        partnerQuery.set('City', userDetails.city);
      }
      if (userDetails && userDetails.address) {
        partnerQuery.set('Address', userDetails.address);
      }
      const tenantRes = await partnerQuery.save(null, { useMasterKey: true });
      // console.log("tenantRes ", tenantRes);
      const extCls = Parse.Object.extend(extClass + '_Users');
      const newObj = new extCls();
      newObj.set('UserId', {
        __type: 'Pointer',
        className: '_User',
        objectId: user.id,
      });
      newObj.set('UserRole', userDetails.role);
      newObj.set('Email', userDetails?.email?.toLowerCase()?.replace(/\s/g, ''));
      newObj.set('Name', userDetails.name);
      if (userDetails?.phone) {
        newObj.set('Phone', userDetails?.phone);
      }
      newObj.set('TenantId', {
        __type: 'Pointer',
        className: 'partners_Tenant',
        objectId: tenantRes.id,
      });
      if (userDetails && userDetails.company) {
        newObj.set('Company', userDetails.company);
      }
      if (userDetails && userDetails.jobTitle) {
        newObj.set('JobTitle', userDetails.jobTitle);
      }
      if (userDetails && userDetails?.timezone) {
        newObj.set('Timezone', userDetails.timezone);
      }
      const extRes = await newObj.save(null, { useMasterKey: true });
      return { message: 'User sign up', sessionToken: user.sessionToken };
    }
  } catch (err) {
    console.log('Err ', err);
  }
}
