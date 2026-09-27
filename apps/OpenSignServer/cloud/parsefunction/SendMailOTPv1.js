import { appName, updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';
import { randomInt } from 'node:crypto';
import { OTP_TTL_MS } from './otpPolicy.js';
import { storeOtp } from './otpClaim.js';

const normalise = email =>
  String(email || '')
    .toLowerCase()
    .replace(/\s/g, '');

async function loadDocument(docId) {
  const query = new Parse.Query('contracts_Document');
  query.equalTo('objectId', docId);
  query.include('Signers');
  query.notEqualTo('IsArchive', true);
  const res = await query.first({ useMasterKey: true });
  return res?.toJSON() || null;
}

export async function userExists(email, { query: newQuery = () => new Parse.Query(Parse.User) } = {}) {
  const query = newQuery();
  query.containedIn('username', [...new Set([email, normalise(email)])]);
  return !!(await query.first({ useMasterKey: true }));
}

// A signer of the document: a linked contact (`Signers[].Email`) or a role filled by email
// only (`Placeholders[].email`).
function isSigner(doc, email) {
  const target = normalise(email);
  const signerEmails = [
    ...(doc?.Signers || []).map(s => s?.Email),
    ...(doc?.Placeholders || []).map(p => p?.email),
  ];
  return signerEmails.some(e => e && normalise(e) === target);
}

function otpHtml(AppName, code) {
  return (
    `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head>` +
    `<body style="margin:0;background:#020617;font-family:system-ui,-apple-system,sans-serif;">` +
    `<div style="background:#020617;padding:40px 16px;">` +
    `<div style="max-width:580px;margin:0 auto;">` +
    `<div style="background:#0f172a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">` +
    `<div style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">` +
    `<img src="https://leaselynx.co.za/logo-LeaseLynx.png" height="110" alt="LeaseLynx" style="display:block;"/>` +
    `</div>` +
    `<div style="padding:36px 40px;">` +
    `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#fb923c;">LEASELYNX SIGNING</p>` +
    `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#ffffff;">Your verification code</h1>` +
    `<p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#cbd5e1;">Enter this code to continue securely in ${AppName}.</p>` +
    `<p style="margin:0 0 28px;font-size:42px;font-weight:800;color:#fb923c;letter-spacing:7px;text-align:center;">` +
    code +
    `</p>` +
    `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#cbd5e1;">The code expires in 10 minutes and can be used once.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.5;color:#94a3b8;">If you did not request it, ignore this email. Never share the code with anyone.</p>` +
    `</div>` +
    `<div style="border-top:1px solid rgba(255,255,255,0.06);padding:18px 40px;background:#080f1e;">` +
    `<p style="margin:0;font-size:12px;color:#334155;">Sent via <strong style="color:#475569;">LeaseLynx</strong> &middot; <a href="mailto:support@leaselynx.co.za?subject=Spam%20report" style="color:#334155;text-decoration:none;">Report spam</a></p>` +
    `</div>` +
    `</div></div></div></body></html>`
  );
}

export function makeSendMailOTPv1(deps = {}) {
  const {
    relay = relayMail,
    loadDocument: loadDoc = loadDocument,
    userExists: isUser = userExists,
    storeOtp: saveOtp = storeOtp,
    countMail = updateMailCount,
    now = () => new Date(),
  } = deps;
  return async function sendMailOTPv1(request) {
    const email = request.params.email;
    if (!email) {
      return 'Please Enter valid email';
    }
    const docId = request.params?.docId;
    const TenantId = request.params.TenantId ? request.params.TenantId : undefined;
    const AppName = appName;

    // Send only to someone this document (or, with no document, this server) knows.
    // Anyone else gets the same answer and no email, so the endpoint cannot be used to
    // mail arbitrary addresses or to probe which addresses are users.
    const doc = docId ? await loadDoc(docId) : null;
    let refused = null;
    if (docId) {
      if (!doc) refused = 'document not found';
      else if (!isSigner(doc, email)) refused = 'email is not a signer of the document';
    } else if (!(await isUser(email))) {
      refused = 'email is not a user';
    }
    if (refused) {
      // Logged, never told to the caller (the same reply either way).
      console.log('SendOTPMailV1: no OTP sent', { docId: docId || null, check: refused });
      return 'Otp send';
    }

    const code = randomInt(100000, 1000000);
    const extUserId = doc?.ExtUserPtr?.objectId || null;
    // Stored before it is sent: a stored code nobody received is harmless, a received
    // code that was never stored cannot be used.
    await saveOtp(email, code, TenantId, new Date(now().getTime() + OTP_TTL_MS));
    try {
      await relay({
        kind: 'otp',
        documentId: docId || null,
        extUserId,
        fromName: AppName,
        to: email,
        subject: `Your ${AppName} verification code`,
        html: otpHtml(AppName, code),
        text: `Your ${AppName} verification code is ${code}. It expires in 10 minutes and can be used once. If you did not request it, ignore this email. Never share the code.`,
      });
    } catch (err) {
      console.log(`SendOTPMailV1 relay error: ${err?.message} (status ${err?.status})`);
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'The OTP email could not be sent.');
    }
    if (extUserId) {
      countMail(extUserId);
    }
    return 'Otp send';
  };
}

export default makeSendMailOTPv1();
