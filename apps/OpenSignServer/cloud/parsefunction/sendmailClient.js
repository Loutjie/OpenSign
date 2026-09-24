import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

// The only safe things to log from a failed HTTP call. An axios error carries its request
// config, and so the X-Parse-Master-Key header and the body (which can hold an OTP).
export function errorSummary(err) {
  return { message: err?.message || String(err), status: err?.response?.status ?? err?.status ?? null };
}

// A mail that failed where no caller can be told (fire-and-forget senders). The tag is the
// hook for the log-based alert in docs/opensign-mail-relay.md.
export function alertMailFailure(what, context, err) {
  console.error(`[mail-relay][ALERT] ${what}`, { ...context, ...(err ? errorSummary(err) : {}) });
}

// Server-side call to sendmailv3 with the master key. Resolves only when sendmailv3
// confirms the send; otherwise throws an Error whose message and status are safe to log.
export async function postSendmailv3(params, { post = axios.post } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Parse-Application-Id': serverAppId,
    'X-Parse-Master-Key': process.env.MASTER_KEY,
  };
  let res;
  try {
    res = await post(`${cloudServerUrl}/functions/sendmailv3`, params, { headers });
  } catch (err) {
    const failure = new Error(`sendmailv3 failed: ${err?.response?.data?.error || err?.message}`);
    failure.status = err?.response?.status ?? null;
    throw failure;
  }
  if (res?.data?.result?.status !== 'success') {
    const failure = new Error('sendmailv3 did not confirm the send');
    failure.status = res?.status ?? null;
    throw failure;
  }
  return res.data.result;
}
