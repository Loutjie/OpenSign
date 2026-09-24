import { updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';
import {
  authorizeDocumentMail,
  callerIdentity,
  makeMailQuota,
  recipientList,
} from './mailGuard.js';

export const spamReportFooter = extUserId =>
  `<p style="font-size: 13px; color:grey; text-align: center;">If you think this email is inappropriate or spam, you may file a complaint with LeaseLynx <a href="mailto:support@leaselynx.co.za?subject=Spam%20report%20for%20user%20ID%20${extUserId}&body=Hello%20Support%20Team%2C%0D%0A%0D%0AI%E2%80%99m%20reporting%20spam%20activity%20coming%20from%20a%20sender%20using%20your%20platform.%0D%0A%0D%0AThe%20messages%20I%20received%20appear%20unsolicited%20and%20suspicious.%20The%20user%20ID%20associated%20with%20the%20emails%20is%3A%20${extUserId}.%20Please%20investigate%20this%20account%20and%20take%20appropriate%20action%20to%20prevent%20further%20abuse.%0D%0A%0D%0AIf%20you%20need%20additional%20details%2C%20I%E2%80%99m%20happy%20to%20provide%20the%20original%20email%20headers%20or%20screenshots.%0D%0A%0D%0AThank%20you%20for%20looking%20into%20this.%0D%0A%0D%0ABest%20regards%2C%0D%0A%5BYour%20Name%5D">here</a>.</p>`;

// Older OpenSign UI builds send the session token in a custom `sessionToken` header,
// which Parse does not read, so `req.user` is unset on those calls. Resolve the token
// here, with the same validity rule Parse applies to X-Parse-Session-Token. Current
// builds send X-Parse-Session-Token, which Parse validates itself (req.user).
export async function userForSessionToken(
  token,
  { query = () => new Parse.Query('_Session'), now = () => new Date() } = {}
) {
  if (!token || typeof token !== 'string') return null;
  const session = await query()
    .equalTo('sessionToken', token)
    .include('user')
    .first({ useMasterKey: true });
  if (!session) return null;
  const expiresAt = session.get('expiresAt');
  if (expiresAt && expiresAt < now()) return null;
  return session.get('user') || null;
}

export function makeSendmailv3({
  relay = relayMail,
  countMail = updateMailCount,
  sessionUser = userForSessionToken,
  authorize = authorizeDocumentMail,
  consumeQuota = makeMailQuota(),
} = {}) {
  return async function sendmailv3(req) {
    const params = req.params || {};
    let extUserId = params.extUserId || '';
    let documentId = null;

    if (req.master) {
      documentId = params.documentId || null;
    } else {
      // A signed-in user may mail only the parties of a document they created or sign,
      // within a daily limit. The documentId is forwarded to LeaseLynx only once checked.
      const token = req.headers?.sessiontoken;
      const caller = callerIdentity(req.user || (token ? await sessionUser(token) : null));
      if (!caller?.id) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permission denied.');
      }
      const recipients = recipientList(params.recipient, params.cc, params.bcc);
      const doc = await authorize({ documentId: params.documentId, caller, recipients });
      await consumeQuota(caller.id, recipients.length);
      documentId = doc.objectId;
      // Attribute the mail to the document's owner, not to a caller-chosen id.
      extUserId = doc.ExtUserPtr?.objectId || '';
    }

    try {
      await relay({
        kind: 'document',
        documentId,
        extUserId: extUserId || null,
        fromName: params.from || '',
        to: params.recipient,
        cc: params.cc || undefined,
        bcc: params.bcc || undefined,
        replyTo: params.replyto || null,
        subject: params.subject,
        html: params.html ? params.html + spamReportFooter(extUserId) : '',
        text: params.text || 'mail',
      });
    } catch (err) {
      console.error('[mail-relay] sendmailv3 relay error', {
        documentId,
        message: err?.message,
        status: err?.status,
        uncertain: err?.uncertain,
      });
      // A thrown error, not a 200 with { status: 'error' }: callers that ignore the
      // result still see the failure.
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Email could not be sent');
    }
    if (extUserId) {
      await countMail(extUserId);
    }
    return { status: 'success' };
  };
}

export default makeSendmailv3();
