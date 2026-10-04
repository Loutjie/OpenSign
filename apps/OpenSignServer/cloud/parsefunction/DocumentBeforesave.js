import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../Utils.js';
import { setDocumentCount } from '../../utils/CountUtils.js';
import { assertOwnerOnlyWrite } from './ownership.js';

// Fields a client that is not the document's owner may write directly: none. Every
// signer action goes through a cloud function with the master key (signPdf saves
// widgets, SignedUrl and AuditTrail; declinedoc; triggerevent; linkcontacttodoc), and
// the client's direct document writes are all owner-only screens (Form, PlaceHolderSign,
// SignyourselfPdf, the drive, sendEmailToSigners, the sent-documents reports' revoke,
// PdfDeclineModal's extend-expiry, which checks isCreator). Add a field here only with
// a client signer flow that writes it.
export const SIGNER_WRITABLE_FIELDS = Object.freeze([]);

// #86: DocumentAftersave gives each signer ACL write on the whole document, so a signer
// could change anything on it: add recipients and mail them, swap the file, repoint the
// webhook, flip IsCompleted or IsEnableOTP, rewrite AuditTrail or the ACL. A client save
// by anyone but the document's creator may now change only SIGNER_WRITABLE_FIELDS; the
// creator's own saves must keep the document in the creator's name (assertOwnedByCaller).
export function assertDocumentWriteAllowed(request) {
  return assertOwnerOnlyWrite(request, SIGNER_WRITABLE_FIELDS, 'document');
}

async function DocumentBeforesave(request) {
  await assertDocumentWriteAllowed(request);
  if (!request.original) {
    const validations = [
      { field: 'Name', max: MAX_NAME_LENGTH },
      { field: 'Note', max: MAX_NOTE_LENGTH },
      { field: 'Description', max: MAX_DESCRIPTION_LENGTH },
    ];

    for (const { field, max } of validations) {
      const value = request?.object?.get(field);
      if (value && value.length > max) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `The "${field}" field must be at most ${max} characters long.`
        );
      }
    }

    const TimeToCompleteDays = request?.object?.get('TimeToCompleteDays') || 15;
    const RemindOnceInEvery = request?.object?.get('RemindOnceInEvery') || 5;
    const AutoReminder = request?.object?.get('AutomaticReminders') || false;
    const reminderCount = TimeToCompleteDays / RemindOnceInEvery;
    if (AutoReminder && reminderCount > 15) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'only 15 reminder allowed');
    }
  }
  try {
    // below code is used to update document when user sent document or self signed
    const document = request.object;
    const oldDocument = request.original;

    // Check if SignedUrl field has been added (transition from undefined to defined)
    if (oldDocument && !oldDocument?.get('SignedUrl') && document?.get('SignedUrl')) {
      if (oldDocument?.get('ExtUserPtr')?.id) {
        setDocumentCount(oldDocument?.get('ExtUserPtr')?.id);
      }
      if (document?.get('Signers') && document.get('Signers').length > 0) {
        document.set('DocSentAt', new Date());
      }
    }
  } catch (err) {
    console.log('err in document beforesave', err.message);
  }
}
export default DocumentBeforesave;
