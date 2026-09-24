import { appName, updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';

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

async function userExists(email) {
  const query = new Parse.Query(Parse.User);
  query.containedIn('username', [...new Set([email, normalise(email)])]);
  return !!(await query.first({ useMasterKey: true }));
}

async function storeOtp(email, code, TenantId) {
  const tempOtp = new Parse.Query('defaultdata_Otp');
  tempOtp.equalTo('Email', email);
  const resultOTP = await tempOtp.first({ useMasterKey: true });
  // A new code starts a new count of wrong attempts (AuthLoginAsMail); an active lock
  // (LockedUntil) is left in place.
  if (resultOTP !== undefined) {
    resultOTP.set('OTP', code);
    resultOTP.set('FailedAttempts', 0);
    await resultOTP.save(null, { useMasterKey: true });
  } else {
    const otpClass = Parse.Object.extend('defaultdata_Otp');
    const newOtpQuery = new otpClass();
    newOtpQuery.set('OTP', code);
    newOtpQuery.set('FailedAttempts', 0);
    newOtpQuery.set('Email', email);
    newOtpQuery.set('TenantId', TenantId);
    await newOtpQuery.save(null, { useMasterKey: true });
  }
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
    `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2563eb;">OTP VERIFICATION</p>` +
    `<h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#ffffff;">One-Time Password</h1>` +
    `<p style="margin:0 0 28px;font-size:14px;color:#94a3b8;">Your OTP for ${AppName} verification is:</p>` +
    `<p style="margin:0 0 28px;font-size:48px;font-weight:800;color:#ffffff;letter-spacing:8px;text-align:center;">` +
    code +
    `</p>` +
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

    const code = Math.floor(1000 + Math.random() * 9000);
    const extUserId = doc?.ExtUserPtr?.objectId || null;
    // Stored before it is sent: a stored code nobody received is harmless, a received
    // code that was never stored cannot be used.
    await saveOtp(email, code, TenantId);
    try {
      await relay({
        kind: 'otp',
        documentId: docId || null,
        extUserId,
        fromName: AppName,
        to: email,
        subject: `Your ${AppName} OTP`,
        html: otpHtml(AppName, code),
        text: 'otp email',
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
