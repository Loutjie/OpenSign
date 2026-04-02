import axios from 'axios';
import { appName, cloudServerUrl, serverAppId } from '../../Utils.js';
const serverUrl = cloudServerUrl;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;
const headers = {
  'Content-Type': 'application/json',
  'X-Parse-Application-Id': APPID,
  'X-Parse-Master-Key': masterKEY,
};

async function sendDeclineMail(doc, publicUrl, userId, reason) {
  try {
    const removePrefill =
      doc?.Placeholders?.length > 0 && doc?.Placeholders?.filter(x => x?.Role !== 'prefill');
    const signUser =
      removePrefill?.length > 0 &&
      removePrefill?.find(x => x?.signerPtr?.UserId?.objectId === userId);

    const sender = doc.ExtUserPtr;
    const pdfName = doc.Name;
    const creatorName = doc.ExtUserPtr.Name;
    const creatorEmail = doc.ExtUserPtr.Email;
    const signerName = signUser?.signerPtr?.Name || '';
    const signerEmail = signUser?.signerPtr?.Email || signUser?.email || '';
    const viewDocUrl = `${publicUrl}/recipientSignPdf/${doc.objectId}`;
    const subject = `Document "${pdfName}" has been declined by ${signerName}`;
    const body =
      `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head>` +
      `<body style="margin:0;background:#020617;font-family:system-ui,-apple-system,sans-serif;">` +
      `<div style="background:#020617;padding:40px 16px;">` +
      `<div style="max-width:580px;margin:0 auto;">` +
      `<div style="background:#0f172a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">` +
      `<div style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">` +
      `<img src="https://leaselynx.co.za/logo-LeaseLynx.png" height="110" alt="LeaseLynx" style="display:block;"/>` +
      `</div>` +
      `<div style="padding:36px 40px;">` +
      `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#f43f5e;">DOCUMENT DECLINED</p>` +
      `<h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#ffffff;">Document declined by ${signerName}</h1>` +
      `<p style="margin:0 0 28px;font-size:14px;color:#94a3b8;">Dear ${creatorName},</p>` +
      `<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">` +
      `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:130px;">Document</td><td style="padding:8px 0;font-size:13px;color:#cbd5e1;font-weight:600;">${pdfName}</td></tr>` +
      `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:130px;">Declined by</td><td style="padding:8px 0;font-size:13px;color:#cbd5e1;font-weight:600;">${signerName} (${signerEmail})</td></tr>` +
      `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:130px;">Date</td><td style="padding:8px 0;font-size:13px;color:#cbd5e1;font-weight:600;">${new Date().toLocaleDateString()}</td></tr>` +
      `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:130px;">Decline reason</td><td style="padding:8px 0;font-size:13px;color:#cbd5e1;font-weight:600;">${reason || 'Not specified'}</td></tr>` +
      `</table>` +
      `<a href="${viewDocUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:1px;border-radius:8px;">VIEW DOCUMENT</a>` +
      `</div>` +
      `<div style="border-top:1px solid rgba(255,255,255,0.06);padding:18px 40px;background:#080f1e;">` +
      `<p style="margin:0;font-size:12px;color:#334155;">Sent via <strong style="color:#475569;">LeaseLynx</strong> &middot; <a href="mailto:support@leaselynx.co.za?subject=Spam%20report" style="color:#334155;text-decoration:none;">Report spam</a></p>` +
      `</div>` +
      `</div></div></div></body></html>`;

    const params = {
      extUserId: sender.objectId,
      from: TenantAppName,
      recipient: creatorEmail,
      subject: subject,
      pdfName: pdfName,
      html: body,
    };
    await axios.post(serverUrl + '/functions/sendmailv3', params, { headers });
  } catch (err) {
    console.log('err in sendnotifymail', err);
  }
}
export default async function declinedocument(request) {
  const docId = request.params.docId;
  const reason = request.params?.reason || '';
  const userId = request.params.userId;
  const declineBy = { __type: 'Pointer', className: '_User', objectId: userId };
  const publicUrl = request.headers.public_url;
  if (!docId) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'missing parameter docId.');
  }
  try {
    const docCls = new Parse.Query('contracts_Document');
    docCls.include('ExtUserPtr.TenantId,Placeholders.signerPtr,Signers');
    const updateDoc = await docCls.get(docId, { useMasterKey: true });
    if (updateDoc) {
      const _doc = JSON.parse(JSON.stringify(updateDoc));
      const isEnableOTP = updateDoc?.get('IsEnableOTP') || false;
      if (!isEnableOTP) {
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        sendDeclineMail(_doc, publicUrl, userId, reason);
        return 'document declined';
      } else {
        if (!request?.user) {
          throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
        }
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        sendDeclineMail(_doc, publicUrl, userId, reason);
        return 'document declined';
      }
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
  } catch (err) {
    console.log('err while decling doc', err);
    throw err;
  }
}
