import { appName } from '../../Utils.js';
import sendMailWithAttachment from './sendMailWithAttachment.js';

export default async function forwardDoc(request) {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized.');
    }
    const { docId, recipients } = request.params;
    const isReceipents = recipients?.length > 0 && recipients?.length <= 10;
    if (docId && isReceipents) {
      const userPtr = { __type: 'Pointer', className: '_User', objectId: request.user.id };
      const docQuery = new Parse.Query('contracts_Document');
      docQuery
        .equalTo('objectId', docId)
        .equalTo('CreatedBy', userPtr)
        .notEqualTo('IsArchive', true)
        .notEqualTo('IsDeclined', true)
        .include('Signers')
        .include('ExtUserPtr')
        .include('Placeholders.signerPtr')
        .include('ExtUserPtr.TenantId');
      const docRes = await docQuery.first({ useMasterKey: true });
      if (!docRes) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
      }
      const _docRes = docRes?.toJSON();
      const docName = _docRes.Name;
      const extUserId = _docRes?.ExtUserPtr?.objectId;
      const TenantAppName = appName;
      const from = _docRes?.SenderName || _docRes?.ExtUserPtr?.Email;
      const replyTo = _docRes?.SenderMail || _docRes?.ExtUserPtr?.Email;
      const senderName = _docRes?.SenderName || _docRes?.ExtUserPtr?.Name;

      try {
        let mailRes;
        for (let i = 0; i < recipients.length; i++) {
          let params = {
            extUserId: extUserId,
            pdfName: docName,
            url: _docRes?.SignedUrl || '',
            recipient: recipients[i],
            subject: `${senderName} has signed the doc - ${docName}`,
            replyto: replyTo || '',
            from: from,
            html:
              `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head>` +
              `<body style="margin:0;background:#020617;font-family:system-ui,-apple-system,sans-serif;">` +
              `<div style="background:#020617;padding:40px 16px;">` +
              `<div style="max-width:580px;margin:0 auto;">` +
              `<div style="background:#0f172a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">` +
              `<div style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">` +
              `<img src="https://leaselynx.co.za/logo-LeaseLynx.png" height="110" alt="LeaseLynx" style="display:block;"/>` +
              `</div>` +
              `<div style="padding:36px 40px;">` +
              `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2563eb;">DOCUMENT COPY</p>` +
              `<h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#ffffff;">Signed Document Copy</h1>` +
              `<p style="margin:0 0 28px;font-size:14px;color:#94a3b8;">A copy of the document <strong style="color:#e2e8f0;">${docName}</strong> is attached to this email. Kindly download the document from the attachment.</p>` +
              `<p style="margin:0;font-size:13px;color:#64748b;">This is an automated email from ${TenantAppName}. For any queries regarding this email, please contact the sender ${replyTo} directly.</p>` +
              `</div>` +
              `<div style="border-top:1px solid rgba(255,255,255,0.06);padding:18px 40px;background:#080f1e;">` +
              `<p style="margin:0;font-size:12px;color:#334155;">Sent via <strong style="color:#475569;">LeaseLynx</strong> &middot; <a href="mailto:support@leaselynx.co.za?subject=Spam%20report" style="color:#334155;text-decoration:none;">Report spam</a></p>` +
              `</div>` +
              `</div></div></div></body></html>`,
          };
          mailRes = await sendMailWithAttachment(params);
          // console.log('mailRes', mailRes);
        }
        return mailRes;
      } catch (error) {
        const msg =
          error?.response?.data?.error ||
          error?.response?.data ||
          error?.message ||
          'Something went wrong.';
        throw new Parse.Error(400, msg);
      }
    } else {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'please provide parameters.');
    }
  } catch (err) {
    console.log('Err in forwardDoc', err);
    throw err;
  }
}
