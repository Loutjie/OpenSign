import fs from 'node:fs';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import {
  cloudServerUrl,
  replaceMailVaribles,
  saveFileUsage,
  getSecureUrl,
  appName,
  serverAppId,
} from '../../../Utils.js';
import GenerateCertificate from './GenerateCertificate.js';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { Placeholder } from './Placeholder.js';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { buildDownloadFilename, parseUploadFile } from '../../../utils/fileUtils.js';
import sendMailWithAttachment from '../sendMailWithAttachment.js';

const serverUrl = cloudServerUrl; // process.env.SERVER_URL;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;
const eSignName = 'LeaseLynx';
const eSigncontact = 'support@leaselynx.co.za';
const docUrl = `${serverUrl}/classes/contracts_Document`;
const headers = {
  'Content-Type': 'application/json',
  'X-Parse-Application-Id': APPID,
  'X-Parse-Master-Key': masterKEY,
};

function generateDocumentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function unlinkFile(path) {
  if (fs.existsSync(path)) {
    try {
      fs.unlinkSync(path);
    } catch (err) {
      console.log('Err in unlink file: ', path);
    }
  }
}

// `updateDoc` is used to create url in from pdfFile
async function uploadFile(pdfName, filepath) {
  try {
    const filedata = fs.readFileSync(filepath);
    let fileUrl;

    const fileRes = await parseUploadFile(pdfName, filedata, 'application/pdf');
    fileUrl = getSecureUrl(fileRes?.url)?.url;

    return { imageUrl: fileUrl };
  } catch (err) {
    console.log('Err ', err);
    // below line of code is used to remove exported signed pdf file from exports folder
    unlinkFile(filepath);
  }
}

// `updateDoc` is used to update signedUrl, AuditTrail, Iscompleted in document
async function updateDoc(docId, url, userId, ipAddress, data, className, sign, documentHash) {
  try {
    const UserPtr = { __type: 'Pointer', className: className, objectId: userId };
    const obj = {
      UserPtr: UserPtr,
      SignedUrl: url,
      Activity: 'Signed',
      ipAddress: ipAddress,
      SignedOn: new Date(),
      Signature: sign,
    };
    let updateAuditTrail;
    if (data.AuditTrail && data.AuditTrail.length > 0) {
      const AuditTrail = JSON.parse(JSON.stringify(data.AuditTrail));
      const existingIndex = AuditTrail.findIndex(
        entry => entry.UserPtr.objectId === userId && entry.Activity !== 'Created'
      );
      existingIndex !== -1
        ? (AuditTrail[existingIndex] = { ...AuditTrail[existingIndex], ...obj })
        : AuditTrail.push(obj);

      updateAuditTrail = AuditTrail;
    } else {
      updateAuditTrail = [obj];
    }

    const auditTrail = updateAuditTrail.filter(x => x.Activity === 'Signed');
    let isCompleted = false;
    if (data.Signers && data.Signers.length > 0) {
      //'removePrefill' is used to remove prefill role from placeholders filed then compare length to change status of document
      const removePrefill =
        data.Placeholders.length > 0 && data.Placeholders.filter(x => x.Role !== 'prefill');
      if (auditTrail.length === removePrefill?.length) {
        isCompleted = true;
      }
    } else {
      isCompleted = true;
    }
    const body = { SignedUrl: url, AuditTrail: updateAuditTrail, IsCompleted: isCompleted };
    if (documentHash && isCompleted) {
      body.DocumentHash = documentHash;
    }
    const signedRes = await axios.put(`${docUrl}/${docId}`, body, { headers });
    return {
      isCompleted: isCompleted,
      message: 'success',
      AuditTrail: updateAuditTrail,
      DocumentHash: documentHash && isCompleted ? documentHash : undefined,
    };
  } catch (err) {
    console.log('update doc err ', err);
    return 'err';
  }
}

// `sendNotifyMail` is used to send notification mail of signer signed the document
async function sendNotifyMail(doc, signUser, mailProvider, publicUrl) {
  try {
    const TenantAppName = appName;

    const auditTrailCount = doc?.AuditTrail?.filter(x => x.Activity === 'Signed')?.length || 0;
    const removePrefill =
      doc?.Placeholders?.length > 0 && doc?.Placeholders?.filter(x => x?.Role !== 'prefill');
    const signersCount = removePrefill?.length;
    const remainingSign = signersCount - auditTrailCount;
    if (remainingSign > 1 && doc?.NotifyOnSignatures) {
      const sender = doc.ExtUserPtr;
      const pdfName = doc.Name;
      const creatorName = doc.ExtUserPtr.Name;
      const creatorEmail = doc.ExtUserPtr.Email;
      const signerName = signUser.Name;
      const signerEmail = signUser.Email;
      const subject = `Document "${pdfName}" has been signed by ${signerName}`;
      const body = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head>
        <body style="margin:0;background:#020617;font-family:system-ui,-apple-system,sans-serif;">
        <div style="background:#020617;padding:40px 16px;">
        <div style="max-width:580px;margin:0 auto;">
        <div style="background:#0f172a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <div style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <img src="https://leaselynx.co.za/logo-LeaseLynx.png" height="110" alt="LeaseLynx" style="display:block;"/>
          </div>
          <div style="padding:36px 40px;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:#fb923c;text-transform:uppercase;letter-spacing:0.2em;">Signature Update</p>
            <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f1f5f9;letter-spacing:-0.4px;line-height:1.2;">A signer has completed their signature</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#64748b;">Document: ${pdfName}</p>
            <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.7;">Dear <strong style="color:#f1f5f9;">${creatorName}</strong>,</p>
            <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.7;"><strong style="color:#f1f5f9;">${signerName}</strong> (${signerEmail}) has signed the document. ${remainingSign} signature${remainingSign === 1 ? '' : 's'} remaining.</p>
            <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:18px 20px;margin:0 0 24px;">
              <table style="border-collapse:collapse;width:100%;">
                <tr>
                  <td style="padding:5px 16px 5px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;width:38%;">Progress</td>
                  <td style="padding:5px 0;font-size:13px;color:#fb923c;font-weight:600;">${auditTrailCount} of ${signersCount} signed</td>
                </tr>
              </table>
            </div>
            <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
              You will receive a final email with the signed document once all parties have signed.
            </p>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.06);padding:18px 40px;background:#080f1e;">
            <p style="margin:0;font-size:12px;color:#334155;">
              Sent via <strong style="color:#475569;">${TenantAppName}</strong> &middot;
              <a href="mailto:support@leaselynx.co.za?subject=Spam%20report" style="color:#334155;text-decoration:none;">Report spam</a>
            </p>
          </div>
        </div>
        </div></div></body></html>`;

      const params = {
        extUserId: sender.objectId,
        from: TenantAppName,
        recipient: creatorEmail,
        subject: subject,
        pdfName: pdfName,
        html: body,
        mailProvider: mailProvider,
      };
      await axios.post(serverUrl + '/functions/sendmailv3', params, { headers });
    }
  } catch (err) {
    console.log('err in sendnotifymail', err);
  }
}

// `sendCompletedMail` is used to send copy of completed document mail
async function sendCompletedMail(obj) {
  const url = obj.doc?.SignedUrl;
  const doc = obj.doc;
  const sender = obj.doc.ExtUserPtr;
  const pdfName = doc.Name;
  const TenantAppName = appName;
  const logo =
    "<img src='https://leaselynx.co.za/logo-LeaseLynx.png' height='110' alt='LeaseLynx' style='display:block;'/>";

  let signersMail;
  if (doc?.Signers?.length > 0) {
    const isOwnerExistsinSigners = doc?.Signers?.find(x => x.Email === sender.Email);
    signersMail = isOwnerExistsinSigners
      ? doc?.Signers?.map(x => x?.Email)?.join(',')
      : [...doc?.Signers?.map(x => x?.Email), sender.Email]?.join(',');
  } else {
    signersMail = sender.Email;
  }
  const recipient = signersMail;
  let subject = `Document "${pdfName}" has been signed by all parties`;
  let body = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head>
    <body style="margin:0;background:#020617;font-family:system-ui,-apple-system,sans-serif;">
    <div style="background:#020617;padding:40px 16px;">
    <div style="max-width:580px;margin:0 auto;">
    <div style="background:#0f172a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
      <div style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
        ${logo}
      </div>
      <div style="padding:36px 40px;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;letter-spacing:0.2em;">Signing Complete</p>
        <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f1f5f9;letter-spacing:-0.4px;line-height:1.2;">All parties have signed</h1>
        <p style="margin:0 0 28px;font-size:14px;color:#64748b;">Document: ${pdfName}</p>
        <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.7;">All parties have successfully signed <strong style="color:#f1f5f9;">"${pdfName}"</strong>. The signed document and completion certificate are attached to this email.</p>
        <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:18px 20px;margin:0 0 24px;">
          <table style="border-collapse:collapse;width:100%;">
            <tr>
              <td style="padding:5px 16px 5px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;width:38%;">Status</td>
              <td style="padding:5px 0;font-size:13px;color:#22c55e;font-weight:600;">Fully Executed</td>
            </tr>
            <tr style="border-top:1px solid rgba(255,255,255,0.04);">
              <td style="padding:5px 16px 5px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;">Signers</td>
              <td style="padding:5px 0;font-size:13px;color:#e2e8f0;">${doc?.Signers?.map(x => x.Name).join(', ') || sender.Name}</td>
            </tr>
            <tr style="border-top:1px solid rgba(255,255,255,0.04);">
              <td style="padding:5px 16px 5px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;">Sent by</td>
              <td style="padding:5px 0;font-size:13px;color:#94a3b8;">${sender.Name} (${sender.Email})</td>
            </tr>
          </table>
        </div>
        <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
          If you didn't expect this email, contact <a href="mailto:${sender.Email}" style="color:#64748b;text-decoration:underline;">${sender.Email}</a>.
        </p>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.06);padding:18px 40px;background:#080f1e;">
        <p style="margin:0;font-size:12px;color:#334155;">
          Sent via <strong style="color:#475569;">${TenantAppName}</strong> &middot;
          <a href="mailto:support@leaselynx.co.za?subject=Spam%20report" style="color:#334155;text-decoration:none;">Report spam</a>
        </p>
      </div>
    </div>
    </div></div></body></html>`;

  if (obj?.isCustomMail) {
    const tenant = sender?.TenantId;
    if (tenant) {
      subject = tenant?.CompletionSubject ? tenant?.CompletionSubject : subject;
      body = tenant?.CompletionBody ? tenant?.CompletionBody : body;
    } else {
      const userId = sender?.CreatedBy?.objectId || sender?.UserId?.objectId;
      if (userId) {
        try {
          const tenantQuery = new Parse.Query('partners_Tenant');
          tenantQuery.equalTo('UserId', {
            __type: 'Pointer',
            className: '_User',
            objectId: userId,
          });
          const tenantRes = await tenantQuery.first({ useMasterKey: true });
          if (tenantRes) {
            const _tenantRes = JSON.parse(JSON.stringify(tenantRes));
            subject = _tenantRes?.CompletionSubject ? tenant?.CompletionSubject : subject;
            body = _tenantRes?.CompletionBody ? tenant?.CompletionBody : body;
          }
        } catch (err) {
          console.log('error in fetch tenant in signpdf', err.message);
        }
      }
    }
    const expireDate = doc.ExpiryDate.iso;
    const newDate = new Date(expireDate);
    const localExpireDate = newDate.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const variables = {
      document_title: pdfName,
      note: doc?.Note,
      sender_name: doc?.SenderName || sender.Name,
      sender_mail: doc?.SenderMail || sender.Email,
      sender_phone: sender?.Phone || '',
      receiver_name: sender.Name,
      receiver_email: sender.Email,
      receiver_phone: sender?.Phone || '',
      expiry_date: localExpireDate,
      company_name: sender.Company,
    };
    const replaceVar = replaceMailVaribles(subject, body, variables);
    subject = replaceVar.subject;
    body = replaceVar.body;
  }
  const Bcc = doc?.Bcc?.length > 0 ? doc.Bcc.map(x => x.Email) : [];
  const updatedBcc = doc?.SenderMail ? [...Bcc, doc?.SenderMail] : Bcc;
  const formatId = doc?.ExtUserPtr?.DownloadFilenameFormat;
  const filename = pdfName?.length > 100 ? pdfName?.slice(0, 100) : pdfName;
  const docName = buildDownloadFilename(formatId, {
    docName: filename,
    email: doc?.ExtUserPtr?.Email,
    isSigned: true,
  });
  const params = {
    extUserId: sender.objectId,
    url: url,
    from: doc?.SenderName || TenantAppName,
    replyto: doc?.SenderMail || doc?.ExtUserPtr?.Email || '',
    recipient: recipient,
    subject: subject,
    pdfName: pdfName,
    html: body,
    mailProvider: obj.mailProvider,
    bcc: updatedBcc?.length > 0 ? updatedBcc : '',
    certificatePath: `./exports/signed_certificate_${doc.objectId}.pdf`,
    filename: docName,
  };
  try {
    const res = await sendMailWithAttachment(params);
    // console.log("res ", res)
    if (res?.status !== 'success') {
      unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
    }
  } catch (err) {
    unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
  }
}

// `sendMailsaveCertifcate` is used send completion mail and update complete status of document
async function sendMailsaveCertifcate(doc, pfx, isCustomMail, mailProvider, filename) {
  const certificate = await GenerateCertificate(doc);
  const certificatePdf = await PDFDocument.load(certificate);
  const P12Buffer = fs.readFileSync(pfx.name);
  const p12 = new P12Signer(P12Buffer, { passphrase: pfx.passphrase || null });
  //  `pdflibAddPlaceholder` is used to add code of only digitial sign in certificate
  pdflibAddPlaceholder({
    pdfDoc: certificatePdf,
    reason: `Digitally signed by ${eSignName}.`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await certificatePdf.save();
  const CertificateBuffer = Buffer.from(pdfWithPlaceholderBytes);
  //`new signPDF` create new instance of CertificateBuffer and p12Buffer
  const certificateOBJ = new SignPdf();
  // `signedCertificate` is used to sign certificate digitally
  const signedCertificate = await certificateOBJ.sign(CertificateBuffer, p12);
  const certificatePath = `./exports/signed_certificate_${doc.objectId}.pdf`;

  //below is used to save signed certificate in exports folder
  fs.writeFileSync(certificatePath, signedCertificate);
  const file = await uploadFile('certificate.pdf', certificatePath);
  const body = { CertificateUrl: file.imageUrl };
  await axios.put(`${docUrl}/${doc.objectId}`, body, { headers });
  // used in API only
  if (doc.IsSendMail === false) {
    console.log("don't send mail");
  } else {
    sendCompletedMail({ isCustomMail, doc, mailProvider, filename });
  }
  saveFileUsage(CertificateBuffer.length, file.imageUrl, doc?.CreatedBy?.objectId);
  unlinkFile(pfx.name);
  return file.imageUrl;
}

/**
 * Process a PDF for signing:
 * - updates audit trail, generates certificate.
 * - Optionally inserts a signature placeholder (Placeholder()).
 * - Otherwise (no merge + no placeholder), it flattens forms for finalization.
 *
 * @param {Object} _resDoc - Document details (expects AuditTrail, etc.)
 * @param {Buffer|Uint8Array} pdfBytes - Original PDF bytes
 * @param {string} [options.reason] - Reason text used in placeholder
 * @param {string} [options.UserPtr] -  user pointer (for audit trail)
 * @param {string} [options.ipAddress] - IP (for audit trail)
 * @param {string} [options.Signature] - Signature (for audit trail)
 * @returns {Promise<Buffer>} merged PDF Buffer
 */
async function processPdf(_resDoc, PdfBuffer, reason) {
  // No CC merge; operate directly on the original PDF
  const pdfDoc = await PDFDocument.load(PdfBuffer);
  const form = pdfDoc.getForm();
  // Updates the field appearances to ensure visual changes are reflected.
  form.updateFieldAppearances();
  // Flattens the form, converting all form fields into non-editable, static content
  form.flatten();
  Placeholder({
    pdfDoc: pdfDoc,
    reason: `Digitally signed by ${eSignName} for ${reason}`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await pdfDoc.save();
  return Buffer.from(pdfWithPlaceholderBytes);
}
/**
 *
 * @param docId Id of Document in which user is signing
 * @param pdfFile base64 of pdfFile which you want sign
 * @returns if success {status, data} else {status, message}
 */
async function PDF(req) {
  const docId = req.params.docId;
  const randomNumber = Math.floor(Math.random() * 5000);
  const pfxname = `keystore_${randomNumber}.pfx`;
  try {
    const userIP = req.headers['x-real-ip']; // client IPaddress
    const reqUserId = req.params.userId;
    const isCustomMail = req.params.isCustomCompletionMail || false;
    const mailProvider = req.params.mailProvider || '';
    const sign = req.params.signature || '';
    const publicUrl = req.headers.public_url;
    // below bode is used to get info of docId
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.include('ExtUserPtr,Signers,ExtUserPtr.TenantId,Bcc,CreatedBy');
    docQuery.equalTo('objectId', docId);
    const resDoc = await docQuery.first({ useMasterKey: true });
    if (!resDoc) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
    const IsEnableOTP = resDoc?.get('IsEnableOTP') || false;
    // if `IsEnableOTP` is false then we don't have to check authentication
    if (IsEnableOTP) {
      if (!req?.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
      }
    }
    const _resDoc = resDoc?.toJSON();
    let signUser;
    let className;
    // `reqUserId` is send throught pdfrequest signing flow
    if (reqUserId) {
      // to get contracts_Contactbook details for currentuser from reqUserId
      const _contractUser = _resDoc.Signers.find(x => x.objectId === reqUserId);
      if (_contractUser) {
        signUser = _contractUser;
        className = 'contracts_Contactbook';
      }
    } else {
      className = 'contracts_Users';
      signUser = _resDoc.ExtUserPtr;
    }

    const username = signUser.Name;
    const userEmail = signUser.Email;
    console.log(`[signPdf] docId=${docId}, userId=${reqUserId}, signUser=${signUser?.Name}, className=${className}`);
    if (req.params.pdfFile) {
      //  `PdfBuffer` used to create buffer from pdf file
      let PdfBuffer = Buffer.from(req.params.pdfFile, 'base64');
      console.log(`[signPdf] PdfBuffer size: ${PdfBuffer.length}`);
      //  `P12Buffer` used to create buffer from p12 certificate
      let pfxFile = process.env.PFX_BASE64;
      let passphrase = process.env.PASS_PHRASE;
      if (_resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64) {
        pfxFile = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64;
        passphrase = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.password;
      }
      const pfx = { name: pfxname, passphrase: passphrase };
      const P12Buffer = Buffer.from(pfxFile, 'base64');
      fs.writeFileSync(pfxname, P12Buffer);
      const UserPtr = { __type: 'Pointer', className: className, objectId: signUser.objectId };
      const obj = { UserPtr: UserPtr, SignedUrl: '', Activity: 'Signed', ipAddress: userIP };
      let updateAuditTrail;
      if (_resDoc.AuditTrail && _resDoc.AuditTrail.length > 0) {
        updateAuditTrail = [..._resDoc.AuditTrail, obj];
      } else {
        updateAuditTrail = [obj];
      }

      const auditTrail = updateAuditTrail.filter(x => x.Activity === 'Signed');
      let isCompleted = false;
      if (_resDoc.Signers && _resDoc.Signers.length > 0) {
        const removePrefill =
          _resDoc?.Placeholders?.length > 0 &&
          _resDoc?.Placeholders?.filter(x => x?.Role !== 'prefill');
        if (auditTrail.length === removePrefill?.length) {
          // if (auditTrail.length === _resDoc.Signers.length) {
          isCompleted = true;
        }
      } else {
        isCompleted = true;
      }
      // below regex is used to replace all word with "_" except A to Z, a to z, numbers
      const docName = _resDoc?.Name?.replace(/[^a-zA-Z0-9._-]/g, '_')?.toLowerCase();
      const filename = docName?.length > 100 ? docName?.slice(0, 100) : docName;
      const name = `${filename}_${randomNumber}.pdf`;
      let filePath = `./exports/${name}`;
      let signedFilePath = `./exports/signed_${name}`;
      let pdfSize = PdfBuffer.length;
      let documentHash;
      console.log(`[signPdf] isCompleted=${isCompleted}, auditTrail signed count=${auditTrail.length}, signers=${_resDoc.Signers?.length}, placeholders=${_resDoc.Placeholders?.length}`);
      if (isCompleted) {
        console.log('[signPdf] Document is complete — processing final PDF...');
        const signersName = _resDoc.Signers?.map(x => x.Name + ' <' + x.Email + '>');
        const reason =
          signersName && signersName.length > 0
            ? signersName?.join(', ')
            : username + ' <' + userEmail + '>';
        const p12Cert = new P12Signer(P12Buffer, { passphrase: passphrase || null });
        signedFilePath = `./exports/signed_${name}`;
        PdfBuffer = await processPdf(_resDoc, PdfBuffer, reason, UserPtr, userIP, sign);
        //`new signPDF` create new instance of pdfBuffer and p12Buffer
        const OBJ = new SignPdf();
        // `signedDocs` is used to signpdf digitally
        const signedDocs = await OBJ.sign(PdfBuffer, p12Cert);

        //`saveUrl` is used to save signed pdf in exports folder
        fs.writeFileSync(signedFilePath, signedDocs);
        pdfSize = signedDocs.length;
        documentHash = generateDocumentHash(signedDocs);
        console.log(`✅ PDF digitally signed created: ${signedFilePath} \n`);
      } else {
        //`saveUrl` is used to save signed pdf in exports folder
        fs.writeFileSync(signedFilePath, PdfBuffer);
        pdfSize = PdfBuffer.length;
        console.log(`New Signed PDF created called: ${signedFilePath}`);
      }

      // `uploadFile` is used to upload pdf to aws s3 and get it's url
      console.log(`[signPdf] Uploading signed PDF: signed_${name}`);
      const data = await uploadFile(`signed_${name}`, signedFilePath);
      console.log(`[signPdf] Upload result:`, data?.imageUrl ? 'success' : 'FAILED', data?.imageUrl?.substring(0, 80));

      if (data && data.imageUrl) {
        // `axios` is used to update signed pdf url in contracts_Document classes for given DocId
        const updatedDoc = await updateDoc(
          req.params.docId, //docId
          data.imageUrl, // SignedUrl
          signUser.objectId, // userID
          userIP, // client ipAddress,
          _resDoc, // auditTrail, signers, etc data
          className, // className based on flow
          sign, // sign base64
          isCompleted ? documentHash : undefined
        );
        sendNotifyMail(_resDoc, signUser, mailProvider, publicUrl);
        saveFileUsage(pdfSize, data.imageUrl, _resDoc?.CreatedBy?.objectId);

        // Call external webhook if configured (LeaseLynx integration)
        if (_resDoc.WebhookUrl) {
          const webhookEvent = updatedDoc?.isCompleted ? 'document_completed' : 'document_signed';
          try {
            await axios.post(_resDoc.WebhookUrl, {
              event: webhookEvent,
              document_id: docId,
              signed_document_url: data.imageUrl,
              signer: { name: signUser?.Name, email: signUser?.Email, role: signUser?.Role || '' },
              is_completed: !!updatedDoc?.isCompleted,
              total_signers: _resDoc.Signers?.length || 0,
              signers_completed: updateAuditTrail?.filter(x => x.Activity === 'Signed')?.length || 0,
            });
            console.log(`Webhook sent: ${webhookEvent} → ${_resDoc.WebhookUrl}`);
          } catch (whErr) {
            console.log(`Webhook failed: ${whErr.message}`);
          }
        }

        if (updatedDoc && updatedDoc.isCompleted) {
          const hashForDoc = documentHash || updatedDoc?.DocumentHash;
          const doc = { ..._resDoc, AuditTrail: updatedDoc.AuditTrail, SignedUrl: data.imageUrl };
          if (hashForDoc) {
            doc.DocumentHash = hashForDoc;
          }
          sendMailsaveCertifcate(doc, pfx, isCustomMail, mailProvider, `signed_${name}`);
        } else {
          unlinkFile(pfxname);
        }
        // below code is used to remove exported signed pdf file from exports folder
        unlinkFile(signedFilePath);
        // console.log(`New Signed PDF created called: ${filePath}`);
        if (updatedDoc.message === 'success') {
          return { status: 'success', data: data.imageUrl };
        } else {
          const error = new Error('Please provide required parameters!');
          error.code = 400; // Set the error code (e.g., 400 for bad request)
          throw error;
        }
      }
    } else {
      const error = new Error('Pdf file not present!');
      error.code = 400; // Set the error code (e.g., 400 for bad request)
      throw error;
    }
  } catch (err) {
    console.log('Err in signpdf', err?.message || err);
    console.log('Err stack:', err?.stack);
    const body = { DebugginLog: err?.message };
    try {
      await axios.put(`${docUrl}/${docId}`, body, { headers });
    } catch (err) {
      console.log('err in saving debugginglog', err);
    }
    unlinkFile(pfxname);
    throw err;
  }
}
export default PDF;
