import { updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';

export const spamReportFooter = extUserId =>
  `<p style="font-size: 13px; color:grey; text-align: center;">If you think this email is inappropriate or spam, you may file a complaint with LeaseLynx <a href="mailto:support@leaselynx.co.za?subject=Spam%20report%20for%20user%20ID%20${extUserId}&body=Hello%20Support%20Team%2C%0D%0A%0D%0AI%E2%80%99m%20reporting%20spam%20activity%20coming%20from%20a%20sender%20using%20your%20platform.%0D%0A%0D%0AThe%20messages%20I%20received%20appear%20unsolicited%20and%20suspicious.%20The%20user%20ID%20associated%20with%20the%20emails%20is%3A%20${extUserId}.%20Please%20investigate%20this%20account%20and%20take%20appropriate%20action%20to%20prevent%20further%20abuse.%0D%0A%0D%0AIf%20you%20need%20additional%20details%2C%20I%E2%80%99m%20happy%20to%20provide%20the%20original%20email%20headers%20or%20screenshots.%0D%0A%0D%0AThank%20you%20for%20looking%20into%20this.%0D%0A%0D%0ABest%20regards%2C%0D%0A%5BYour%20Name%5D">here</a>.</p>`;

// OpenSign's own UI calls sendmailv3 with its session token in a custom `sessionToken`
// header, which Parse does not read, so `req.user` is unset on those calls. Resolve the
// token here, with the same validity rule Parse applies to X-Parse-Session-Token.
async function userForSessionToken(token) {
  const session = await new Parse.Query('_Session')
    .equalTo('sessionToken', token)
    .first({ useMasterKey: true });
  if (!session) return null;
  const expiresAt = session.get('expiresAt');
  if (expiresAt && expiresAt < new Date()) return null;
  return session.get('user') || null;
}

export function makeSendmailv3({
  relay = relayMail,
  countMail = updateMailCount,
  sessionUser = userForSessionToken,
} = {}) {
  return async function sendmailv3(req) {
    const token = req.headers?.sessiontoken;
    const caller = req.master || req.user || (token ? await sessionUser(token) : null);
    if (!caller) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permission denied.');
    }
    const extUserId = req.params?.extUserId || '';
    try {
      await relay({
        kind: 'document',
        documentId: req.params.documentId || null,
        extUserId: extUserId || null,
        fromName: req.params.from || '',
        to: req.params.recipient,
        bcc: req.params.bcc || undefined,
        replyTo: req.params.replyto || null,
        subject: req.params.subject,
        html: req.params.html ? req.params.html + spamReportFooter(extUserId) : '',
        text: req.params.text || 'mail',
      });
    } catch (err) {
      console.log(
        `sendmailv3 relay error: ${err?.message} (status ${err?.status}, uncertain ${err?.uncertain})`
      );
      return { status: 'error' };
    }
    if (extUserId) {
      await countMail(extUserId);
    }
    return { status: 'success' };
  };
}

export default makeSendmailv3();
