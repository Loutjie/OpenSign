import fs from 'node:fs';
import https from 'https';
import axios from 'axios';
import { updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';
import { spamReportFooter } from './sendMailv3.js';

function safeUnlink(filePath, label = 'file') {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      console.log(`sendMailWithAttachment unlink ${label} error`);
    }
  }
}

// `downloadToFile` writes the document at `url` to `filePath`; resolves 'success' or 'error'.
function downloadToFile(url, filePath) {
  const Pdf = fs.createWriteStream(filePath);
  return new Promise(resolve => {
    const isSecure = new URL(url)?.protocol === 'https:' && new URL(url)?.hostname !== 'localhost';
    if (isSecure) {
      https
        .get(url, function (response) {
          response.pipe(Pdf);
          response.on('end', () => resolve('success'));
        })
        .on('error', e => {
          console.error(`error: ${e.message}`);
          resolve('error');
        });
    } else {
      const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // Disable SSL validation
      const newlocalUrl = url.replace('https://localhost:3001/api', 'http://localhost:8080');
      axios
        .get(newlocalUrl, { responseType: 'stream', httpsAgent: httpsAgent })
        .then(response => {
          response.data.pipe(Pdf);
          Pdf.on('finish', () => resolve('success'));
          Pdf.on('error', () => resolve('error'));
        })
        .catch(e => {
          console.log('error in localurl', e.message);
          resolve('error');
        });
    }
  });
}

function readAfterFlush(filePath) {
  return new Promise(resolve => setTimeout(() => resolve(fs.readFileSync(filePath)), 100));
}

// `sendMailWithAttachment` sends the completion and forwarded-document mail, with the
// signed PDF and its certificate attached, through the LeaseLynx relay.
export default async function sendMailWithAttachment(params, { relay = relayMail } = {}) {
  const extUserId = params?.extUserId || '';
  const message = {
    kind: 'document',
    documentId: params.documentId || null,
    extUserId: extUserId || null,
    fromName: params.from || '',
    to: params.recipient,
    bcc: params.bcc || undefined,
    replyTo: params.replyto || null,
    subject: params.subject,
    html: params?.html ? params.html + spamReportFooter(extUserId) : '',
    text: params.text || 'mail',
    attachments: [],
  };
  const certificatePath = params.certificatePath || `./exports/certificate.pdf`;
  const testPdf = `test_${Math.floor(Math.random() * 5000)}.pdf`;
  try {
    if (params.url) {
      const downloaded = await downloadToFile(params.url, testPdf);
      if (downloaded !== 'success') {
        // Fail closed: never send a completion mail with a missing or partial document.
        return { status: 'error' };
      }
      const PdfBuffer = await readAfterFlush(testPdf);
      const pdfName = params.pdfName && `${params.pdfName}.pdf`;
      message.attachments.push({
        filename: params.filename || pdfName || 'exported.pdf',
        contentType: 'application/pdf',
        content: PdfBuffer,
      });
      if (fs.existsSync(certificatePath)) {
        try {
          const certificateBuffer = fs.readFileSync(certificatePath);
          message.attachments.push({
            filename: 'certificate.pdf',
            contentType: 'application/pdf',
            content: certificateBuffer,
          });
        } catch (err) {
          console.log('sendMailWithAttachment read certificate error', err);
        }
      }
    }
    await relay(message);
  } catch (err) {
    console.log(
      `sendMailWithAttachment error: ${err?.message} (status ${err?.status}, uncertain ${err?.uncertain})`
    );
    return { status: 'error' };
  } finally {
    safeUnlink(testPdf, 'pdf');
  }
  if (params.url) {
    safeUnlink(certificatePath, 'certificate');
  }
  if (extUserId) {
    await updateMailCount(extUserId);
  }
  return { status: 'success' };
}
