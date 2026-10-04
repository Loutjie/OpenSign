// Who owns a contracts_Document or contracts_Template, as the beforeSave triggers decide
// it for client (non-master) saves. The master key (LeaseLynx, signPdf, linkcontacttodoc,
// createduplicate, saveastemplate...) is never limited here.

export const idOf = value => (value && (value.id || value.objectId)) || null;

const forbid = message => {
  throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
};

// The caller's own contracts_Users row ids. A client sets ExtUserPtr from its own
// Extand_Class row (Form.jsx, Utils.js createDocument, batchdocuments).
async function isCallersExtUser(extUserId, callerId) {
  const row = await new Parse.Query('contracts_Users')
    .equalTo('objectId', extUserId)
    .first({ useMasterKey: true });
  return !!row && idOf(row.get('UserId')) === callerId;
}

// A client may only create a document or template in its own name: CreatedBy is the
// caller and ExtUserPtr (when set) is the caller's own contracts_Users row. Otherwise a
// client could make someone else the "owner" (mailGuard.js mails the owner) or attribute
// a document to another tenant. An owner may not hand its document to someone else
// either. Throws OPERATION_FORBIDDEN.
export async function assertOwnedByCaller(request) {
  if (request.master) return;
  const callerId = request.user?.id;
  if (!callerId) forbid('Sign in to create or change this.');
  const object = request.object;
  if (idOf(object.get('CreatedBy')) !== callerId) forbid('CreatedBy must be you.');
  const extUserId = idOf(object.get('ExtUserPtr'));
  const extChanged = !request.original || extUserId !== idOf(request.original.get('ExtUserPtr'));
  if (extUserId && extChanged && !(await isCallersExtUser(extUserId, callerId))) {
    forbid('ExtUserPtr must be your own user.');
  }
}
