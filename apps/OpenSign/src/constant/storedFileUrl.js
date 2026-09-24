// Mirrors apps/OpenSignServer/cloud/parsefunction/storedFileUrl.js
// (`isLocalParseFileUrl` and its `parse` helper). This client is a separate app with
// no shared package, so the rule is copied; change both together.
//
// Parse's own file URLs are served by the OpenSign server under <mount>/files/…; only
// those may go to `fileupload` for a token. Objects in our S3/GCS bucket already carry
// a signature, and anything else is not ours. Decided by host and path (case-sensitive),
// never by substring: the production bucket is named leaselynx-opensign-files.

const parse = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

export function isLocalParseFileUrl(url, serverUrl) {
  const u = parse(url);
  const s = parse(serverUrl);
  if (!u || !s || u.host !== s.host) return false;
  return u.pathname.startsWith(`${s.pathname.replace(/\/+$/, "")}/files/`);
}
