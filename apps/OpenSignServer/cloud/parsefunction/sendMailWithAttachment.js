import fs from 'node:fs';
import https from 'https';
import axios from 'axios';
import { updateMailCount } from '../../Utils.js';
import { relayMail } from '../../leaselynxRelay.js';
import { spamReportFooter } from './sendMailv3.js';
import { alertMailFailure } from './sendmailClient.js';
import getPresignedUrl from './getSignedUrl.js';

function safeUnlink(filePath, label = 'file') {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      console.log(`sendMailWithAttachment unlink ${label} error`);
    }
  }
}

export const DOWNLOAD_TIMEOUT_MS = 60_000;

// `downloadToFile` writes the document at `url` to `filePath`. Resolves { ok: true } only
// for an HTTP 200 whose body has been completely written (the file stream's 'finish');
// otherwise { ok: false, reason }. The whole download, from connecting to the last byte
// written, must finish within `timeoutMs`; a server that never answers is abandoned.
export function downloadToFile(url, filePath, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    let settled = false;
    let body;
    let file;
    const abort = new AbortController();
    const done = result => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      done({ ok: false, reason: `timed out after ${timeoutMs} ms` });
      abort.abort();
      body?.destroy?.();
      file?.destroy?.();
    }, timeoutMs);
    const onResponse = (statusCode, responseBody) => {
      body = responseBody;
      if (settled) return body?.destroy?.();
      if (statusCode !== 200) {
        body?.resume?.();
        return done({ ok: false, reason: `HTTP ${statusCode}` });
      }
      file = fs.createWriteStream(filePath);
      file.on('finish', () => done({ ok: true }));
      file.on('error', e => done({ ok: false, reason: e.message }));
      body.on('error', e => done({ ok: false, reason: e.message }));
      body.pipe(file);
    };
    const isSecure = new URL(url)?.protocol === 'https:' && new URL(url)?.hostname !== 'localhost';
    if (isSecure) {
      https
        .get(url, { signal: abort.signal }, response => onResponse(response.statusCode, response))
        .on('error', e => done({ ok: false, reason: e.message }));
    } else {
      const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // Disable SSL validation
      const newlocalUrl = url.replace('https://localhost:3001/api', 'http://localhost:8080');
      axios
        .get(newlocalUrl, {
          responseType: 'stream',
          httpsAgent: httpsAgent,
          validateStatus: () => true,
          signal: abort.signal,
        })
        .then(response => onResponse(response.status, response.data))
        .catch(e => done({ ok: false, reason: e.message }));
    }
  });
}

const isPdf = buffer => buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF';

// `sendMailWithAttachment` sends the completion and forwarded-document mail, with the
// signed PDF and its certificate attached, through the LeaseLynx relay. Resolves
// { status: 'success' } or { status: 'error' }; it never sends a mail without a
// complete, real PDF when a url is given.
export default async function sendMailWithAttachment(
  params,
  { relay = relayMail, downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS, sign = getPresignedUrl } = {}
) {
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
      let downloadUrl;
      try {
        // The bucket is private: fetch through a fresh signature, never the stored URL.
        downloadUrl = await sign(params.url);
      } catch (err) {
        alertMailFailure('document download failed; no email sent', {
          documentId: message.documentId,
          reason: err.message,
        });
        return { status: 'error' };
      }
      const downloaded = await downloadToFile(downloadUrl, testPdf, {
        timeoutMs: downloadTimeoutMs,
      });
      if (!downloaded.ok) {
        alertMailFailure('document download failed; no email sent', {
          documentId: message.documentId,
          reason: downloaded.reason,
        });
        return { status: 'error' };
      }
      const PdfBuffer = fs.readFileSync(testPdf);
      if (!isPdf(PdfBuffer)) {
        alertMailFailure('downloaded document is not a PDF; no email sent', {
          documentId: message.documentId,
          bytes: PdfBuffer.length,
        });
        return { status: 'error' };
      }
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
          console.log('sendMailWithAttachment read certificate error', err?.message);
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
