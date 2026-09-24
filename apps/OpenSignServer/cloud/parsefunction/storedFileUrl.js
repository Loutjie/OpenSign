// Where a stored OpenSign file lives. Parse's own file URLs are served by this
// server under <mount>/files/…; objects in our S3/GCS bucket must be read through
// a signed URL; anything else (data: URLs, external images) is not ours to sign.
// Decided by host and path, never by substring: the production bucket is named
// leaselynx-opensign-files.

const parse = url => {
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
  return u.pathname.startsWith(`${s.pathname.replace(/\/+$/, '')}/files/`);
}

export function isBucketUrl(url, bucket, endpoint) {
  const u = parse(url);
  const e = parse(endpoint);
  if (!u || !e || !bucket) return false;
  if (u.host === e.host) return u.pathname.split('/')[1] === bucket;
  return u.host === `${bucket}.${e.host}`;
}

// OpenSign stores flat keys (<hash>_<name>); the key is the last path segment in
// both path-style (host/bucket/key) and virtual-hosted (bucket.host/key) URLs.
export function objectKeyFromUrl(url) {
  const { pathname } = new URL(url);
  return decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
}
