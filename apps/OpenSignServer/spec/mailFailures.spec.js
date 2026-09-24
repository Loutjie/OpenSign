// spec/mailFailures.spec.js
// Group B of the relay fix wave: every failed OpenSign email is visible, either to the
// caller or as a [mail-relay][ALERT] log, and no log carries the master key or an OTP.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import ParseSDK from 'parse/node';
import {
  relayMail,
  RelayError,
  checkMailRelayConfig,
  makeApiCallback,
  parseMailKind,
} from '../leaselynxRelay.js';
import { makeSendmailv3 } from '../cloud/parsefunction/sendMailv3.js';
import { postSendmailv3 } from '../cloud/parsefunction/sendmailClient.js';
import sendMailWithAttachment from '../cloud/parsefunction/sendMailWithAttachment.js';
import { makeForwardDoc } from '../cloud/parsefunction/ForwardDoc.js';
import { makeSendMailOTPv1 } from '../cloud/parsefunction/SendMailOTPv1.js';
import { makeDeleteUserOtp } from '../cloud/customRoute/deleteAccount/deleteUserOtp.js';
import { sendDeleteOtpEmail } from '../cloud/customRoute/deleteAccount/deleteUtils.js';
import { sendDeclineMail } from '../cloud/parsefunction/declinedocument.js';
import {
  sendBatchMail,
  sendOwnerSummaryEmail,
  startBulkSendInBackground,
} from '../cloud/parsefunction/createBatchDocs.js';
import { sendNotifyMail, sendCompletedMail } from '../cloud/parsefunction/pdf/PDF.js';

globalThis.Parse ??= ParseSDK;
const MASTER = 'test-master-key-do-not-log';

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

// Records console.error/console.log lines as text for the duration of a spec.
function captureLogs() {
  const lines = [];
  const record = (...args) => lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  spyOn(console, 'error').and.callFake(record);
  spyOn(console, 'log').and.callFake(record);
  return lines;
}

// An axios.post stand-in. `fail` rejects like axios does, with the request config attached.
function fakePost({ fail = false, result = { status: 'success' } } = {}) {
  const calls = [];
  const post = async (url, params, config) => {
    calls.push({ url, params, config });
    if (fail) {
      throw Object.assign(new Error('Request failed with status code 400'), {
        config: { headers: config.headers, data: JSON.stringify(params) },
        response: { status: 400, data: { code: 141, error: 'Email could not be sent' } },
      });
    }
    return { status: 200, data: { result } };
  };
  return { calls, post };
}

beforeEach(() => {
  process.env.MASTER_KEY = MASTER;
});

// ─── B1 ────────────────────────────────────────────────────────────────────

describe('B1 sendmailv3 fails visibly', () => {
  it('throws SCRIPT_FAILED when the relay fails, and counts nothing', async () => {
    const counted = [];
    captureLogs();
    const handler = makeSendmailv3({
      relay: async () => { throw new RelayError('down', { status: 502 }); },
      countMail: async id => counted.push(id),
    });
    const err = await rejection(handler({ params: { extUserId: 'e1', recipient: 'a@x.test', subject: 'S' }, master: true, headers: {} }));
    expect(err?.code).toBe(ParseSDK.Error.SCRIPT_FAILED);
    expect(err?.message).toBe('Email could not be sent');
    expect(counted).toEqual([]);
  });
});

describe('B1/D7 server-side sendmailv3 callers', () => {
  it('postSendmailv3 posts to sendmailv3 with the master key and resolves on a confirmed send', async () => {
    const { calls, post } = fakePost();
    await postSendmailv3({ recipient: 'a@x.test' }, { post });
    expect(calls[0].url).toMatch(/\/functions\/sendmailv3$/);
    expect(calls[0].config.headers['X-Parse-Master-Key']).toBe(MASTER);
    expect(calls[0].params).toEqual({ recipient: 'a@x.test' });
  });
  it('postSendmailv3 rejects on a thrown call or an unconfirmed result, without the master key in the error', async () => {
    const thrown = await rejection(postSendmailv3({}, { post: fakePost({ fail: true }).post }));
    expect(thrown?.message).toContain('Email could not be sent');
    expect(thrown?.status).toBe(400);
    expect(JSON.stringify(thrown) + thrown.message).not.toContain(MASTER);
    const unconfirmed = await rejection(postSendmailv3({}, { post: fakePost({ result: { status: 'error' } }).post }));
    expect(unconfirmed?.message).toContain('did not confirm');
  });

  it('deleteUserOtp answers 500 and stores no code when the email fails, and does not log the OTP', async () => {
    const logs = captureLogs();
    const saved = [];
    const extUser = { id: 'ext1', get: () => undefined, set: (k, v) => saved.push([k, v]), save: async () => saved.push('saved') };
    const handler = makeDeleteUserOtp({
      findUser: async () => extUser,
      sendOtp: (user, otp) => sendDeleteOtpEmail({ ...user, get: k => (k === 'Email' ? 'admin@x.test' : undefined) }, otp, { post: fakePost({ fail: true }).post }),
    });
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { userId: 'u1' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to send OTP' });
    expect(saved).toEqual([]);
    expect(logs.join('\n')).not.toContain(MASTER);
    expect(logs.join('\n')).not.toMatch(/Your verification code/);
  });
  it('deleteUserOtp answers ok and stores the code once the email is sent, to the ext user\'s own address', async () => {
    const { calls, post } = fakePost();
    const saved = [];
    const extUser = { id: 'ext1', get: k => (k === 'Email' ? 'admin@x.test' : undefined), set: (k, v) => saved.push(k), save: async () => {} };
    const handler = makeDeleteUserOtp({ findUser: async () => extUser, sendOtp: (u, otp) => sendDeleteOtpEmail(u, otp, { post }) });
    const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { userId: 'u1' } }, res);
    expect(res.body.ok).toBe(true);
    expect(calls[0].params.recipient).toBe('admin@x.test');
    expect(saved).toContain('DeleteOTP');
  });

  const doc = {
    objectId: 'doc1', Name: 'Lease', NotifyOnSignatures: true,
    ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.test' },
    Placeholders: [{ Role: 'Tenant', signerPtr: { UserId: { objectId: 'u2' }, Name: 'T', Email: 't@x.test' } }, { Role: 'Landlord' }, { Role: 'Witness' }],
    AuditTrail: [],
  };

  it('sendNotifyMail sends the documentId to the owner, and ALERTs (without the master key) when it fails', async () => {
    const ok = fakePost();
    await sendNotifyMail(doc, { Name: 'T', Email: 't@x.test' }, '', 'https://x', { post: ok.post });
    expect(ok.calls[0].params).toEqual(jasmine.objectContaining({ documentId: 'doc1', recipient: 'owner@x.test' }));

    const logs = captureLogs();
    await sendNotifyMail(doc, { Name: 'T', Email: 't@x.test' }, '', 'https://x', { post: fakePost({ fail: true }).post });
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] signer notification email failed');
    expect(logs.join('\n')).toContain('doc1');
    expect(logs.join('\n')).not.toContain(MASTER);
  });

  it('sendDeclineMail ALERTs when the owner email fails, without the master key', async () => {
    const ok = fakePost();
    await sendDeclineMail(doc, 'https://x', 'u2', 'no', { post: ok.post });
    expect(ok.calls[0].params).toEqual(jasmine.objectContaining({ documentId: 'doc1', recipient: 'owner@x.test' }));
    const logs = captureLogs();
    await sendDeclineMail(doc, 'https://x', 'u2', 'no', { post: fakePost({ fail: true }).post });
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] decline email failed');
    expect(logs.join('\n')).not.toContain(MASTER);
  });

  it('sendBatchMail sends each signer with the documentId and ALERTs naming the recipients it could not email', async () => {
    const batchDoc = {
      objectId: 'doc7', Name: 'Lease', createdAt: '2026-09-24T00:00:00Z', SendinOrder: false,
      ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.test' },
      Placeholders: [{ Role: 'Tenant', email: 'a@x.test' }, { Role: 'prefill' }, { Role: 'Surety', email: 'b@x.test' }],
      Signers: [],
    };
    const ok = fakePost();
    expect(await sendBatchMail(batchDoc, 'https://sign.example', { post: ok.post })).toEqual({ sent: 2, failed: [] });
    expect(ok.calls.map(c => [c.params.recipient, c.params.documentId])).toEqual([['a@x.test', 'doc7'], ['b@x.test', 'doc7']]);
    expect(ok.calls[0].config.headers['X-Parse-Master-Key']).toBe(MASTER);

    const logs = captureLogs();
    const res = await sendBatchMail(batchDoc, 'https://sign.example', { post: fakePost({ fail: true }).post });
    expect(res.failed.map(f => f.recipient)).toEqual(['a@x.test', 'b@x.test']);
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] bulk send signing email failed');
    expect(logs.join('\n')).toContain('b@x.test');
    expect(logs.join('\n')).not.toContain(MASTER);
  });

  it('sendOwnerSummaryEmail ALERTs on failure', async () => {
    const logs = captureLogs();
    await sendOwnerSummaryEmail({ ownerEmail: 'owner@x.test', total: 1, created: 1, failed: 0 }, { post: fakePost({ fail: true }).post });
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] bulk send owner summary email failed');
  });

  it('sendBatchMail never rejects (it runs unawaited): a document it cannot mail is an ALERT', async () => {
    const logs = captureLogs();
    const broken = { objectId: 'doc8', Placeholders: [{ Role: 'Tenant', email: 'a@x.test' }] };
    const res = await sendBatchMail(broken, undefined, { post: fakePost().post });
    expect(res).toEqual({ sent: 0, failed: [jasmine.objectContaining({ recipient: null })] });
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] bulk send signing email failed');
    expect(logs.join('\n')).toContain('doc8');
  });
});

describe('B1/A3 createBatchDocs: the daily limit before the document exists', () => {
  const documents = [{
    Name: 'Lease', URL: 'https://files/x.pdf', SendinOrder: false,
    CreatedBy: { objectId: 'u1' },
    ExtUserPtr: { className: 'contracts_Users', objectId: 'ext1', Name: 'Owner', Email: 'owner@x.test' },
    Placeholders: [{ Role: 'Tenant', email: 'a@x.test' }, { Role: 'prefill' }, { Role: 'Surety', email: 'b@x.test' }],
    Signers: [],
  }];
  const deps = (over = {}) => {
    const order = [];
    return {
      order,
      consumeQuota: async (userId, count) => { order.push(['quota', userId, count]); },
      findExtUser: async () => ({ id: 'ext1', toJSON: () => ({ objectId: 'ext1' }) }),
      postBatch: async body => {
        order.push(['create', body.requests.length]);
        return { data: [{ success: { objectId: 'doc9', createdAt: '2026-09-24T00:00:00Z' } }] };
      },
      sendMail: async doc => { order.push(['mail', doc.objectId]); },
      countDocument: () => {},
      ...over,
    };
  };

  it('counts the signers against the caller\'s limit before creating the document, then mails', async () => {
    const d = deps();
    const res = await startBulkSendInBackground('u1', documents, '', {}, 'quicksend', 'https://sign.example', d);
    expect(res).toEqual({ total: 1, created: 1, failed: 0 });
    expect(d.order).toEqual([['quota', 'u1', 2], ['create', 1], ['mail', 'doc9']]);
  });

  it('creates no document and mails no one when the limit is reached', async () => {
    const d = deps({
      consumeQuota: async () => { throw new ParseSDK.Error(ParseSDK.Error.OPERATION_FORBIDDEN, 'Daily email limit reached'); },
    });
    const err = await rejection(startBulkSendInBackground('u1', documents, '', {}, 'quicksend', 'https://sign.example', d));
    expect(err?.message).toBe('Daily email limit reached');
    expect(d.order).toEqual([]);
  });
});

// ─── B3 ────────────────────────────────────────────────────────────────────

describe('B3 completion email', () => {
  const doc = { objectId: 'doc5', Name: 'Lease', SignedUrl: 'https://files/x.pdf', ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.test' }, Signers: [{ Email: 't@x.test', Name: 'T' }] };

  it('passes the documentId (D7) and ALERTs with it when the send fails', async () => {
    const sent = [];
    await sendCompletedMail({ doc }, { send: async p => { sent.push(p); return { status: 'success' }; } });
    expect(sent[0]).toEqual(jasmine.objectContaining({ documentId: 'doc5', recipient: 't@x.test,owner@x.test' }));

    const logs = captureLogs();
    await sendCompletedMail({ doc }, { send: async () => ({ status: 'error' }) });
    expect(logs.join('\n')).toContain('[mail-relay][ALERT] completion email failed');
    expect(logs.join('\n')).toContain('"documentId":"doc5"');
    expect(logs.join('\n')).toContain('"status":"error"');
  });
});

// ─── B2 / D7 apiCallback ───────────────────────────────────────────────────

describe('B2 Parse mail adapter apiCallback', () => {
  it('never rejects: a failed relay is an ALERT log', async () => {
    const errors = [];
    const apiCallback = makeApiCallback({ relay: async () => { throw new RelayError('down', { status: 500 }); }, logger: { error: (...a) => errors.push(a) } });
    await expectAsync(apiCallback({ payload: { to: 'u@x.test', subject: 'Password Reset', text: 't' } })).toBeResolved();
    expect(errors[0][0]).toBe('[mail-relay][ALERT] Parse account email failed');
    expect(errors[0][1]).toEqual({ kind: 'password_reset', message: 'down', status: 500 });
  });
  it('maps the template subject to a kind and relays the payload', async () => {
    expect(parseMailKind({ subject: 'Password Reset for LeaseLynx' })).toBe('password_reset');
    expect(parseMailKind({ subject: 'Please verify your e-mail' })).toBe('email_verification');
    const sent = [];
    await makeApiCallback({ relay: async m => sent.push(m) })({ payload: { to: 'u@x.test', subject: 'Verify', html: '<p>h</p>', text: 't' } });
    expect(sent).toEqual([{ kind: 'email_verification', to: 'u@x.test', subject: 'Verify', html: '<p>h</p>', text: 't' }]);
  });
});

// ─── B4 download ───────────────────────────────────────────────────────────

describe('B4 sendMailWithAttachment download', () => {
  let server;
  let base;
  const pdfBytes = Buffer.from('%PDF-1.4 synthetic test document');
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/500.pdf') { res.writeHead(500); return res.end('server error'); }
      if (req.url === '/html.pdf') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>not a pdf</html>'); }
      if (req.url === '/slow.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.write(pdfBytes.subarray(0, 8));
        return setTimeout(() => res.end(pdfBytes.subarray(8)), 150);
      }
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(pdfBytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));
  const tempPdfs = () => fs.readdirSync(path.resolve('.')).filter(f => /^test_\d+\.pdf$/.test(f));
  const params = url => ({ documentId: 'doc9', recipient: 'a@x.test', subject: 'Signed', html: '<p>x</p>', url, certificatePath: '/nonexistent/cert.pdf' });

  for (const [name, file, reason] of [['an HTTP 500', '/500.pdf', 'HTTP 500'], ['a body that is not a PDF', '/html.pdf', 'not a PDF']]) {
    it(`sends nothing and ALERTs for ${name}`, async () => {
      const before = tempPdfs();
      const logs = captureLogs();
      const sent = [];
      const res = await sendMailWithAttachment(params(base + file), { relay: async m => sent.push(m) });
      expect(res).toEqual({ status: 'error' });
      expect(sent).toEqual([]);
      expect(logs.join('\n')).toContain('[mail-relay][ALERT]');
      expect(logs.join('\n')).toContain(reason);
      expect(tempPdfs()).toEqual(before);
    });
  }

  it('attaches the whole body of a slow download (resolves on the file finish, not the response end)', async () => {
    const sent = [];
    expect(await sendMailWithAttachment(params(base + '/slow.pdf'), { relay: async m => sent.push(m) })).toEqual({ status: 'success' });
    expect(sent[0].attachments[0].content).toEqual(pdfBytes);
  });
});

// ─── B5 forwarddoc ─────────────────────────────────────────────────────────

describe('B5 forwarddoc aggregates failures', () => {
  const doc = { objectId: 'doc1', Name: 'Lease', CreatedBy: { objectId: 'owner' }, ExtUserPtr: { objectId: 'ext1', Email: 'owner@x.test' },
    Signers: [{ Email: 'a@x.test' }, { Email: 'b@x.test' }] };
  const user = { id: 'owner', get: () => 'owner@x.test' };

  it('throws naming every recipient that was not sent, even when a later one succeeds', async () => {
    captureLogs();
    const handler = makeForwardDoc({
      send: async p => ({ status: p.recipient === 'a@x.test' ? 'error' : 'success' }),
      loadDocument: async () => doc,
      consumeQuota: async () => {},
    });
    const err = await rejection(handler({ params: { docId: 'doc1', recipients: ['a@x.test', 'b@x.test'] }, user }));
    expect(err?.code).toBe(ParseSDK.Error.SCRIPT_FAILED);
    expect(err?.message).toBe('The document could not be emailed to: a@x.test');
  });
  it('returns success only when all were sent', async () => {
    const handler = makeForwardDoc({ send: async () => ({ status: 'success' }), loadDocument: async () => doc, consumeQuota: async () => {} });
    expect(await handler({ params: { docId: 'doc1', recipients: ['a@x.test', 'b@x.test'] }, user })).toEqual({ status: 'success' });
  });
});

// ─── B6 relayMail ──────────────────────────────────────────────────────────

describe('B6 relayMail answers', () => {
  const msg = { kind: 'document', to: ['t@x.test'], subject: 'S' };
  const answering = (status, json) => async url => (url.startsWith('http://metadata')
    ? { ok: true, text: async () => 'T' }
    : { ok: status >= 200 && status < 300, status, json: async () => json });

  for (const status of ['submitted', 'captured', 'archive_failed']) {
    it(`accepts a 2xx with status ${status}`, async () => {
      expect(await relayMail(msg, { fetchImpl: answering(200, { status, logicalId: 'L' }), relayUrl: 'https://r' })).toEqual({ status: 'success', logicalId: 'L' });
    });
  }
  it('treats a 2xx without an accepted status as uncertain', async () => {
    for (const json of [{}, { status: 'failed' }]) {
      await expectAsync(relayMail(msg, { fetchImpl: answering(200, json), relayUrl: 'https://r' }))
        .toBeRejectedWith(jasmine.objectContaining({ status: 200, uncertain: true }));
    }
  });
  for (const status of [500, 504]) {
    it(`treats HTTP ${status} as uncertain`, async () => {
      await expectAsync(relayMail(msg, { fetchImpl: answering(status, { error: 'x' }), relayUrl: 'https://r' }))
        .toBeRejectedWith(jasmine.objectContaining({ status, uncertain: true }));
    });
  }
  it('treats HTTP 404 as definite', async () => {
    await expectAsync(relayMail(msg, { fetchImpl: answering(404, {}), relayUrl: 'https://r' }))
      .toBeRejectedWith(jasmine.objectContaining({ status: 404, uncertain: false }));
  });
  it('gives up after the timeout, as uncertain', async () => {
    const fetchImpl = async (url, opts) => {
      if (url.startsWith('http://metadata')) return { ok: true, text: async () => 'T' };
      return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    };
    const err = await rejection(relayMail(msg, { fetchImpl, relayUrl: 'https://r', timeoutMs: 20 }));
    expect(err).toEqual(jasmine.objectContaining({ status: 0, uncertain: true }));
    expect(err.message).toContain('no answer within 20 ms');
  });
});

// ─── B7 OTP order ──────────────────────────────────────────────────────────

describe('B7 SendOTPMailV1', () => {
  const doc = { objectId: 'doc1', Signers: [{ Email: 'signer@x.test' }] };
  it('stores the code before relaying it, so a relay failure leaves a stored (harmless) code', async () => {
    const events = [];
    const handler = makeSendMailOTPv1({
      relay: async () => { events.push('relay'); throw new RelayError('down'); },
      loadDocument: async () => doc,
      userExists: async () => false,
      storeOtp: async () => events.push('store'),
      countMail: async () => {},
    });
    captureLogs();
    await expectAsync(handler({ params: { email: 'signer@x.test', docId: 'doc1' } })).toBeRejected();
    expect(events).toEqual(['store', 'relay']);
  });
  it('logs the docId and the check that refused, and answers the same', async () => {
    const logs = captureLogs();
    const handler = makeSendMailOTPv1({ relay: async () => {}, loadDocument: async id => (id === 'doc1' ? doc : null), userExists: async () => false, storeOtp: async () => {}, countMail: async () => {} });
    expect(await handler({ params: { email: 'x@x.test', docId: 'doc1' } })).toBe('Otp send');
    expect(await handler({ params: { email: 'x@x.test', docId: 'gone' } })).toBe('Otp send');
    expect(await handler({ params: { email: 'x@x.test' } })).toBe('Otp send');
    expect(logs).toEqual([
      'SendOTPMailV1: no OTP sent {"docId":"doc1","check":"email is not a signer of the document"}',
      'SendOTPMailV1: no OTP sent {"docId":"gone","check":"document not found"}',
      'SendOTPMailV1: no OTP sent {"docId":null,"check":"email is not a user"}',
    ]);
  });
});

// ─── B8 startup ────────────────────────────────────────────────────────────

describe('B8 startup check', () => {
  const run = env => {
    const errors = [];
    const ok = checkMailRelayConfig(env, { error: m => errors.push(m) });
    return { ok, errors };
  };
  it('ALERTs in production without a relay URL', () => {
    for (const env of [{ NODE_ENV: 'production' }, { SERVER_URL: 'https://opensign.example/app' }]) {
      expect(run(env)).toEqual({ ok: false, errors: ['[mail-relay][ALERT] LEASELYNX_MAIL_RELAY_URL is not set: OpenSign cannot send email'] });
    }
  });
  it('is quiet with a relay URL, or locally', () => {
    expect(run({ NODE_ENV: 'production', LEASELYNX_MAIL_RELAY_URL: 'https://r' })).toEqual({ ok: true, errors: [] });
    expect(run({ SERVER_URL: 'http://localhost:8080/app' })).toEqual({ ok: true, errors: [] });
  });
});
