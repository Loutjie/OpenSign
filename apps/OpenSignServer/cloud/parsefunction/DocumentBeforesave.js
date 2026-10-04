import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../Utils.js';
import { setDocumentCount } from '../../utils/CountUtils.js';
import { normaliseEmail } from './mailGuard.js';

const idOf = value => (value && (value.id || value.objectId)) || null;

// Everything about a document that only its owner may change:
// - who its parties are, and so who may be emailed about it: mailGuard.js allows its
//   Placeholders emails, its Signers and its owner (ExtUserPtr, CreatedBy); the completion
//   mail (pdf/PDF.js) also goes to its Bcc and SenderMail;
// - where news of it goes: WebhookUrl receives every signing event (with the signed
//   file's URL; LeaseLynx archives the lease from it), RedirectUrl is where each signer's
//   browser goes after signing;
// - its files: URL/SignedUrl is what every later party sees and signs, and what
//   getsignedurl signs for anyone holding the document link (#112).
// Widget positions and values inside Placeholders are not included.
export function ownerOnlyFields(doc) {
  const get = key => doc?.get?.(key);
  const list = key => (Array.isArray(get(key)) ? get(key) : []);
  const str = key => get(key) || null;
  return JSON.stringify({
    CreatedBy: idOf(get('CreatedBy')),
    ExtUserPtr: idOf(get('ExtUserPtr')),
    Signers: list('Signers').map(idOf),
    Bcc: list('Bcc').map(idOf),
    SenderMail: normaliseEmail(get('SenderMail')),
    Placeholders: list('Placeholders').map(p => [
      normaliseEmail(p?.email),
      p?.signerObjId || null,
      idOf(p?.signerPtr),
    ]),
    WebhookUrl: str('WebhookUrl'),
    RedirectUrl: str('RedirectUrl'),
    URL: str('URL'),
    SignedUrl: str('SignedUrl'),
    CertificateUrl: str('CertificateUrl'),
  });
}

// #86: DocumentAftersave gives each signer ACL write on the whole document, so a signer
// could add a recipient (a Placeholders email, a Signer, Bcc, SenderMail) and then mail
// anyone through sendmailv3/forwarddoc, take the document over (CreatedBy, ExtUserPtr),
// redirect its webhook, or swap its file. Only the document's creator, or the master key
// (signPdf, linkcontacttodoc, LeaseLynx), may change ownerOnlyFields. A signer's other
// writes (decline, widget values) still save.
export function assertOwnerOnlyFieldsUnchanged(request) {
  if (request.master || !request.original) return;
  const ownerId = idOf(request.original.get('CreatedBy'));
  if (ownerId && request.user?.id === ownerId) return;
  if (ownerOnlyFields(request.original) !== ownerOnlyFields(request.object)) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      "Only the document's owner can change its recipients, files or notifications."
    );
  }
}

async function DocumentBeforesave(request) {
  assertOwnerOnlyFieldsUnchanged(request);
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
