import { appName, smtpenable, updateMailCount } from '../../Utils.js';
async function getDocument(docId) {
  try {
    const query = new Parse.Query('contracts_Document');
    query.equalTo('objectId', docId);
    query.include('ExtUserPtr');
    query.include('CreatedBy');
    query.include('Signers');
    query.include('AuditTrail.UserPtr');
    query.include('ExtUserPtr.TenantId');
    query.include('Placeholders');
    query.notEqualTo('IsArchive', true);
    const res = await query.first({ useMasterKey: true });
    const _res = res?.toJSON();
    return _res?.ExtUserPtr?.objectId;
  } catch (err) {
    console.log('err ', err);
  }
}
async function sendMailOTPv1(request) {
  try {
    let code = Math.floor(1000 + Math.random() * 9000);
    let email = request.params.email;
    let TenantId = request.params.TenantId ? request.params.TenantId : undefined;
    const AppName = appName;

    if (email) {
      const recipient = request.params.email;
      const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
      try {
        await Parse.Cloud.sendEmail({
          sender: AppName + ' <' + mailsender + '>',
          recipient: recipient,
          subject: `Your ${AppName} OTP`,
          text: 'otp email',
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
            `</div></div></div></body></html>`,
        });
        console.log('OTP sent', code);
        if (request.params?.docId) {
          const extUserId = await getDocument(request.params?.docId);
          if (extUserId) {
            updateMailCount(extUserId);
          }
        }
      } catch (err) {
        console.log('error in send OTP mail', err);
      }
      const tempOtp = new Parse.Query('defaultdata_Otp');
      tempOtp.equalTo('Email', email);
      const resultOTP = await tempOtp.first({ useMasterKey: true });
      // console.log('resultOTP', resultOTP);
      if (resultOTP !== undefined) {
        const updateOtpQuery = new Parse.Query('defaultdata_Otp');
        const updateOtp = await updateOtpQuery.get(resultOTP.id, {
          useMasterKey: true,
        });
        updateOtp.set('OTP', code);
        updateOtp.save(null, { useMasterKey: true });
        //   console.log("update otp Res in tempSendOtp ", updateRes);
      } else {
        const otpClass = Parse.Object.extend('defaultdata_Otp');
        const newOtpQuery = new otpClass();
        newOtpQuery.set('OTP', code);
        newOtpQuery.set('Email', email);
        newOtpQuery.set('TenantId', TenantId);
        await newOtpQuery.save(null, { useMasterKey: true });
        //   console.log("new otp Res in tempSendOtp ", newRes);
      }
      return 'Otp send';
    } else {
      return 'Please Enter valid email';
    }
  } catch (err) {
    console.log('err in sendMailOTPv1');
    console.log(err);
    return err;
  }
}
export default sendMailOTPv1;
