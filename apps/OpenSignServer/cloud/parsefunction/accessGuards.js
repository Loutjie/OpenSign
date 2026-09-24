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

export function registerAccessGuards(cloud) {
  cloud.beforeSave(Parse.User, rejectSelfSignup);
  for (const className of MASTER_ONLY_CLASSES) {
    cloud.beforeFind(className, requireMasterKey);
    cloud.beforeSave(className, requireMasterKey);
    cloud.beforeDelete(className, requireMasterKey);
  }
}
