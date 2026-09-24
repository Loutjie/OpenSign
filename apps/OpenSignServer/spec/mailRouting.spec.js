// spec/mailRouting.spec.js
// Every OpenSign email goes through relayMail (leaselynxRelay.js). This spec checks the
// source for leftover local transports, and exercises the senders with an injected relay.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ParseSDK from 'parse/node';
import { makeSendmailv3 } from '../cloud/parsefunction/sendMailv3.js';
import sendMailWithAttachment from '../cloud/parsefunction/sendMailWithAttachment.js';
import { makeSendMailOTPv1 } from '../cloud/parsefunction/SendMailOTPv1.js';

// Cloud code uses the Parse global that parse-server installs; the unit run has no server.
globalThis.Parse ??= ParseSDK;

const root = path.resolve('.');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const cloudFiles = fs
  .readdirSync(path.join(root, 'cloud'), { recursive: true })
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('cloud', f));

describe('mail routing (static)', () => {
  const sources = [...cloudFiles, 'index.js'].map(f => ({ file: f, src: read(f) }));

  for (const pattern of [/createTransport/, /mailgun/i, /MAILGUN_/, /SMTP_HOST/, /transporterMail/, /transporterSMTP/, /Parse\.Cloud\.sendEmail/]) {
    it(`has no ${pattern} in cloud/**/*.js or index.js`, () => {
      const hits = sources.filter(s => pattern.test(s.src)).map(s => s.file);
      expect(hits).toEqual([]);
    });
  }

  it('imports relayMail in every sender', () => {
    for (const f of [
      'cloud/parsefunction/sendMailv3.js',
      'cloud/parsefunction/sendMailWithAttachment.js',
      'cloud/parsefunction/SendMailOTPv1.js',
      'cloud/parsefunction/sendDeleteUserMail.js',
      'index.js',
    ]) {
      expect(read(f)).withContext(f).toMatch(/import \{[^}]*\brelayMail\b[^}]*\} from '[./]+\/leaselynxRelay\.js'/);
    }
  });

  it('names the kind explicitly for OTP and delete-request mail', () => {
    expect(read('cloud/parsefunction/SendMailOTPv1.js')).toContain("kind: 'otp'");
    expect(read('cloud/parsefunction/sendDeleteUserMail.js')).toContain("kind: 'delete_request'");
  });

  it('sets the Parse mail adapter from the relay URL, not from SMTP or Mailgun', () => {
    const src = read('index.js');
    expect(src).toContain('isMailAdapter = !!process.env.LEASELYNX_MAIL_RELAY_URL');
    expect(src).toContain("appName + ' <noreply@leaselynx.co.za>'");
  });

  it('has deleted sendMailGmailProvider.js and the smtp flags in Utils.js', () => {
    expect(fs.existsSync(path.join(root, 'cloud/parsefunction/sendMailGmailProvider.js'))).toBe(false);
    expect(read('Utils.js')).not.toMatch(/smtpenable|smtpsecure/);
  });

  it('sends the master key on every server-side call to sendmailv3', () => {
    const callers = sources.filter(s => s.src.includes('/functions/sendmailv3'));
    expect(callers.map(s => s.file).sort()).toEqual([
      'cloud/customRoute/deleteAccount/deleteUtils.js',
      'cloud/parsefunction/createBatchDocs.js',
      'cloud/parsefunction/declinedocument.js',
      'cloud/parsefunction/pdf/PDF.js',
    ]);
    for (const { file, src } of callers) {
      expect(src).withContext(file).toContain("'X-Parse-Master-Key': ");
      expect(src).withContext(file).not.toMatch(/headers = \{ 'Content-Type': 'application\/json', 'X-Parse-Application-Id': appId \}/);
    }
  });

  it('passes documentId wherever the document is known', () => {
    const pdf = read('cloud/parsefunction/pdf/PDF.js');
    expect(pdf.match(/documentId: doc\.objectId/g)?.length).toBe(2);
    expect(read('cloud/parsefunction/ForwardDoc.js')).toContain('documentId: docId');
    expect(read('cloud/parsefunction/createBatchDocs.js')).toContain('documentId: document.objectId');
    expect(read('cloud/parsefunction/declinedocument.js')).toContain('documentId: doc.objectId');
  });
});

function recorder({ fail = false } = {}) {
  const calls = [];
  const relay = async message => {
    calls.push(message);
    if (fail) throw Object.assign(new Error('relay down'), { status: 502, uncertain: true });
    return { status: 'success', logicalId: 'L1' };
  };
  return { calls, relay };
}

describe('sendmailv3', () => {
  const params = {
    extUserId: 'ext1',
    documentId: 'doc1',
    from: 'Ada',
    recipient: 'signer@x.test',
    bcc: 'b@x.test',
    replyto: 'owner@x.test',
    subject: 'Please sign',
    html: '<p>sign</p>',
    text: 'sign',
  };

  // The checks for callers without the master key are in mailSecurity.spec.js.
  it('relays once as a document with the passed documentId for a master-key caller', async () => {
    const { calls, relay } = recorder();
    const counted = [];
    const handler = makeSendmailv3({ relay, countMail: async id => counted.push(id) });
    const res = await handler({ params, master: true, headers: {} });
    expect(res).toEqual({ status: 'success' });
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(jasmine.objectContaining({
      kind: 'document', documentId: 'doc1', extUserId: 'ext1', fromName: 'Ada',
      to: 'signer@x.test', bcc: 'b@x.test', replyTo: 'owner@x.test', subject: 'Please sign', text: 'sign',
    }));
    expect(calls[0].html.startsWith('<p>sign</p>')).toBe(true);
    expect(calls[0].html).toContain('file a complaint with LeaseLynx');
    expect(counted).toEqual(['ext1']);
  });

  it('sends null documentId when none is passed', async () => {
    const { calls, relay } = recorder();
    const handler = makeSendmailv3({ relay, countMail: async () => {} });
    const rest = { ...params };
    delete rest.documentId;
    await handler({ params: rest, master: true, headers: {} });
    expect(calls[0].documentId).toBeNull();
  });

  it('rejects a call with neither a user nor the master key', async () => {
    const { calls, relay } = recorder();
    const handler = makeSendmailv3({ relay, countMail: async () => {}, sessionUser: async () => null });
    let caught;
    try {
      await handler({ params, headers: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught?.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    expect(calls.length).toBe(0);
  });

  it('fails closed with { status: "error" } when the relay throws, and counts nothing', async () => {
    const { calls, relay } = recorder({ fail: true });
    const counted = [];
    const handler = makeSendmailv3({ relay, countMail: async id => counted.push(id) });
    expect(await handler({ params, master: true, headers: {} })).toEqual({ status: 'error' });
    expect(calls.length).toBe(1);
    expect(counted).toEqual([]);
  });
});

describe('sendMailWithAttachment', () => {
  const base = { extUserId: '', documentId: 'doc9', from: 'Ada', recipient: 'a@x.test,b@x.test', subject: 'Signed', html: '<p>done</p>' };
  let server;
  let url;
  const pdfBytes = Buffer.from('%PDF-1.4 synthetic test document');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(pdfBytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/doc.pdf`;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));

  const tempPdfs = () => fs.readdirSync(root).filter(f => /^test_\d+\.pdf$/.test(f));

  it('relays a document mail without attachments when there is no url', async () => {
    const { calls, relay } = recorder();
    expect(await sendMailWithAttachment(base, { relay })).toEqual({ status: 'success' });
    expect(calls[0]).toEqual(jasmine.objectContaining({ kind: 'document', documentId: 'doc9', to: 'a@x.test,b@x.test', attachments: [] }));
  });

  it('attaches the downloaded PDF and the certificate as Buffers and removes the temporary files', async () => {
    const certificatePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cert-')), 'signed_certificate_doc9.pdf');
    fs.writeFileSync(certificatePath, Buffer.from('%PDF certificate'));
    const before = tempPdfs();
    const { calls, relay } = recorder();
    const res = await sendMailWithAttachment({ ...base, url, filename: 'Lease.pdf', certificatePath }, { relay });
    expect(res).toEqual({ status: 'success' });
    const [pdf, cert] = calls[0].attachments;
    expect(pdf).toEqual({ filename: 'Lease.pdf', contentType: 'application/pdf', content: pdfBytes });
    expect(cert).toEqual({ filename: 'certificate.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF certificate') });
    expect(fs.existsSync(certificatePath)).toBe(false);
    expect(tempPdfs()).toEqual(before);
  });

  it('returns { status: "error" } and still removes the temporary PDF when the relay throws', async () => {
    const before = tempPdfs();
    const { calls, relay } = recorder({ fail: true });
    const res = await sendMailWithAttachment({ ...base, url, certificatePath: '/nonexistent/cert.pdf' }, { relay });
    expect(res).toEqual({ status: 'error' });
    expect(calls.length).toBe(1);
    expect(tempPdfs()).toEqual(before);
  });
});

describe('SendOTPMailV1', () => {
  function deps({ doc = null, user = false, fail = false } = {}) {
    const { calls, relay } = recorder({ fail });
    const stored = [];
    return {
      calls,
      stored,
      handler: makeSendMailOTPv1({
        relay,
        loadDocument: async () => doc,
        userExists: async () => user,
        storeOtp: async (email, code) => stored.push({ email, code }),
        countMail: async () => {},
      }),
    };
  }
  const doc = {
    objectId: 'doc1',
    ExtUserPtr: { objectId: 'ext1' },
    Signers: [{ Email: 'Signer@X.test' }],
    Placeholders: [{ email: 'placeholder@x.test' }, { Role: 'prefill' }],
  };

  it('sends to a signer of the document with kind otp and stores the code it sent', async () => {
    const { calls, stored, handler } = deps({ doc });
    expect(await handler({ params: { email: 'signer@x.test', docId: 'doc1' } })).toBe('Otp send');
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(jasmine.objectContaining({ kind: 'otp', documentId: 'doc1', to: 'signer@x.test' }));
    expect(stored.length).toBe(1);
    expect(calls[0].html).toContain(String(stored[0].code));
  });

  it('sends to an email listed only in Placeholders', async () => {
    const { calls, handler } = deps({ doc });
    await handler({ params: { email: 'placeholder@x.test', docId: 'doc1' } });
    expect(calls.length).toBe(1);
  });

  it('sends nothing and stores nothing for an email that is not a signer of the document', async () => {
    const { calls, stored, handler } = deps({ doc, user: true });
    await handler({ params: { email: 'stranger@x.test', docId: 'doc1' } });
    expect(calls.length).toBe(0);
    expect(stored.length).toBe(0);
  });

  it('sends nothing for a document that does not exist', async () => {
    const { calls, handler } = deps({ doc: null, user: true });
    await handler({ params: { email: 'signer@x.test', docId: 'nope' } });
    expect(calls.length).toBe(0);
  });

  it('without a docId, sends only to an existing user', async () => {
    const known = deps({ user: true });
    await known.handler({ params: { email: 'user@x.test' } });
    expect(known.calls.length).toBe(1);
    expect(known.calls[0].documentId).toBeNull();

    const unknown = deps({ user: false });
    await unknown.handler({ params: { email: 'user@x.test' } });
    expect(unknown.calls.length).toBe(0);
    expect(unknown.stored.length).toBe(0);
  });

  it('throws and stores no code when the relay fails', async () => {
    const { stored, handler } = deps({ doc, fail: true });
    await expectAsync(handler({ params: { email: 'signer@x.test', docId: 'doc1' } })).toBeRejected();
    expect(stored.length).toBe(0);
  });
});
