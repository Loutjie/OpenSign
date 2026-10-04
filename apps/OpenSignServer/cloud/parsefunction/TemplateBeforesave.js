import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../Utils.js';
import { setTemplateCount } from '../../utils/CountUtils.js';
import { assertOwnerOnlyWrite } from './ownership.js';

// Fields a client that is not the template's owner may write directly: none.
// TemplateAfterSave gives every template signer ACL write on the whole template, but
// the client's template writes are all the owner's (Form create, TemplatePlaceholder,
// TemplatesReport share-with); a teammate a template is shared with reads it through
// GetTemplate/getReport and has no ACL write. Server-side writers (createduplicate,
// saveastemplate) use the master key.
export const TEMPLATE_SIGNER_WRITABLE_FIELDS = Object.freeze([]);

async function TemplateBeforeSave(request) {
  // A client creates a template only in its own name, and only its owner (or the master
  // key) changes it (getsignedurl signs a template's files for sessions that can read it).
  await assertOwnerOnlyWrite(request, TEMPLATE_SIGNER_WRITABLE_FIELDS, 'template');
  if (!request.original) {
    const validations = [
      { field: 'Name', max: MAX_NAME_LENGTH },
      { field: 'Note', max: MAX_NOTE_LENGTH },
      { field: 'Description', max: MAX_DESCRIPTION_LENGTH },
    ];

    for (const { field, max } of validations) {
      const value = request.object?.get(field);
      if (value && value.length > max) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `The "${field}" field must be at most ${max} characters long.`
        );
      }
    }

    const TimeToCompleteDays = request.object.get('TimeToCompleteDays') || 15;
    const RemindOnceInEvery = request?.object?.get('RemindOnceInEvery') || 5;
    const AutoReminder = request?.object?.get('AutomaticReminders') || false;
    const reminderCount = TimeToCompleteDays / RemindOnceInEvery;
    if (AutoReminder && reminderCount > 15) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'only 15 reminder allowed');
    }
  }
  try {
    if (!request.original) {
      // below code is used to update template when user sent template or self signed
      const template = request.object;

      if (template?.get('ExtUserPtr')?.id) {
        setTemplateCount(template?.get('ExtUserPtr')?.id);
      }
    }
  } catch (err) {
    console.log('err in template beforesave', err.message);
  }
}
export default TemplateBeforeSave;
