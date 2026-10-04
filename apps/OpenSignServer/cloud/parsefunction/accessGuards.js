// Triggers that keep account creation and server-only classes behind the master key.
// LeaseLynx creates every OpenSign user with the master key (getOrCreateOpenSignUser);
// nobody signs themselves up.

export function rejectSelfSignup(request) {
  if (request?.object?.isNew?.() && !request.master) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Sign-up is closed. Your landlord or LeaseLynx creates your account.'
    );
  }
}

export function requireMasterKey(request) {
  if (!request?.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permission denied.');
  }
}

// Classes only cloud code reads or writes (always with the master key): the OTP codes
// and the per-user mail counter. A client that could read defaultdata_Otp could read a
// code; one that could write MailRateLimit could reset its own daily limit.
export const MASTER_ONLY_CLASSES = Object.freeze(['defaultdata_Otp', 'MailRateLimit']);

// contracts_Users fields that say who a row is and what it may do. adduser's admin check
// reads UserRole from the caller's own row, mailGuard.js trusts Email as the owner's
// address, and the class's CLP lets any client create and update rows (setclp migration),
// many of which have no ACL. Clients only ever write profile fields and TourStatus here.
export const EXT_USER_AUTHORITY_FIELDS = Object.freeze([
  'UserId',
  'UserRole',
  'TenantId',
  'OrganizationId',
  'TeamIds',
  'CreatedBy',
  'Email',
]);

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// #86: without this, any signed-in user could write a contracts_Users row naming itself
// contracts_Admin (or set UserRole on its own row) and pass adduser's admin check. Every
// legitimate writer of these fields (usersignup, addadmin, updateuserasadmin, adduser)
// uses the master key.
export function guardExtUserAuthority(request) {
  if (request?.master) return;
  if (!request?.original) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permission denied.');
  }
  for (const field of EXT_USER_AUTHORITY_FIELDS) {
    if (!sameValue(request.object.get(field), request.original.get(field))) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be changed.`);
    }
  }
}

const idOf = value => (value && (value.id || value.objectId)) || null;

// contracts_Contactbook fields that say who a contact is. mailGuard.js trusts a
// document's Signers[].Email, and ContactBookAftersave gives the contact's own user ACL
// write on its row, so a signer could re-address itself and mail any address.
export const CONTACT_IDENTITY_FIELDS = Object.freeze(['Email', 'UserId', 'CreatedBy']);

// #86. Only the master key creates contacts (savecontact, linkcontacttodoc,
// createbatchcontact, editcontact); a direct client create also made ContactBookAftersave
// create a _User for any email. On update, only the contact's creator (or the master
// key) may change its identity; its user may still save TourStatus and the like.
export function guardContactIdentity(request) {
  if (request?.master) return;
  if (!request?.original) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permission denied.');
  }
  const ownerId = idOf(request.original.get('CreatedBy'));
  if (ownerId && request.user?.id === ownerId) return;
  for (const field of CONTACT_IDENTITY_FIELDS) {
    if (!sameValue(request.object.get(field), request.original.get(field))) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be changed.`);
    }
  }
}

export function registerAccessGuards(cloud) {
  cloud.beforeSave(Parse.User, rejectSelfSignup);
  cloud.beforeSave('contracts_Users', guardExtUserAuthority);
  cloud.beforeSave('contracts_Contactbook', guardContactIdentity);
  for (const className of MASTER_ONLY_CLASSES) {
    cloud.beforeFind(className, requireMasterKey);
    cloud.beforeSave(className, requireMasterKey);
    cloud.beforeDelete(className, requireMasterKey);
  }
}
