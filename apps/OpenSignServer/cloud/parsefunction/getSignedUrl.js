import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { isAuthenticated } from '../../utils/AuthUtils.js';
import { isLocalParseFileUrl, isBucketUrl, objectKeyFromUrl } from './storedFileUrl.js';
dotenv.config({ quiet: true });

// Lifetime of a read-time signature. Long enough that a URL loaded with a page stays
// valid while the user works through a modal; upload-time URLs are 900 s as well.
export const READ_URL_TTL_SECONDS = 900;

// Storage mode, read at call time (Utils.js `useLocal` is fixed when it is imported).
// Lower-cased like `useLocal`, so both agree on which adapter index.js chose.
export const isLocalStorage = () => process.env.USE_LOCAL?.toLowerCase() === 'true';

const LOCAL_TOKENS_DISABLED = 'Local file tokens are disabled in S3 mode.';

function makeEndpoint(endpoint) {
  if (!endpoint) return '';

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  return `https://${endpoint}`;
}

function makeS3Client() {
  const accessKeyId = process.env.DO_ACCESS_KEY_ID;

  const secretAccessKey = process.env.DO_SECRET_ACCESS_KEY;

  const region = process.env.DO_REGION;

  const endpoint = makeEndpoint(process.env.DO_ENDPOINT);

  return new S3Client({
    region,
    endpoint, // endpoint should be Url e.g. https://blr1.digitaloceanspaces.com)
    credentials: { accessKeyId, secretAccessKey },
    // Path-style (host/bucket/key), matching the path-style DO_BASEURL the adapter
    // writes; no checksum parameter, which GCS's XML API does not accept on a GET.
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// Startup check for S3 mode (index.js). The adapter stores every file as
// `${DO_BASEURL}/<key>`, and only a URL that isBucketUrl accepts is ever signed. If
// DO_BASEURL, DO_SPACE and DO_ENDPOINT disagree, every stored URL would be handed out
// unsigned from a private bucket, so the server must not start. Returns the error
// message, or null when the configuration can sign.
export function bucketConfigError(env = process.env) {
  const probe = `${env.DO_BASEURL}/probe.pdf`;
  if (env.DO_BASEURL && isBucketUrl(probe, env.DO_SPACE, makeEndpoint(env.DO_ENDPOINT))) {
    return null;
  }
  return (
    `DO_BASEURL (${env.DO_BASEURL || 'unset'}) is not a URL in bucket DO_SPACE ` +
    `(${env.DO_SPACE || 'unset'}) on DO_ENDPOINT (${env.DO_ENDPOINT || 'unset'}): ` +
    'stored files could not be signed.'
  );
}

const isOurBucketUrl = url =>
  isBucketUrl(url, process.env.DO_SPACE, makeEndpoint(process.env.DO_ENDPOINT));

// `getPresignedUrl` returns a readable URL for a stored file: a JWT-carrying URL for a
// local Parse file (local storage only), a fresh signature for an object in our bucket,
// and any other URL (data: URLs, external images) unchanged. In S3 mode a legacy local
// Parse URL passes through unchanged: it mints nothing (the /files/ route answers 403),
// and the afterFind hooks that call this must not fail a lookup over one old value.
export default async function getPresignedUrl(url) {
  if (isLocalParseFileUrl(url, process.env.SERVER_URL)) {
    return isLocalStorage() ? presignedlocalUrl(url) : url;
  }
  if (!isOurBucketUrl(url)) return url;
  const command = new GetObjectCommand({
    Bucket: process.env.DO_SPACE,
    Key: objectKeyFromUrl(url),
  });
  return presign(makeS3Client(), command, { expiresIn: READ_URL_TTL_SECONDS });
}

// `resolveStoredUrl` is what the afterFind hooks hand out for a stored file URL. The
// storage mode is read per call, not from Utils.js `useLocal` (fixed at import), so a
// hook signs by the mode the process runs with.
export async function resolveStoredUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  return isLocalStorage() ? presignedlocalUrl(rawUrl) : getPresignedUrl(rawUrl);
}

// `documentFileKeys` returns the object keys of every bucket file a contracts_Document
// (or contracts_Template) references: its PDF, signed PDF, certificate, and every
// placeholder image (`options.response` or `options.defaultValue`) of every role, the
// shape Utils.js `handleValidImage` walks. Anything not in our bucket is skipped.
// `isStored` picks which URLs count: our bucket's by default, local Parse file URLs in
// local storage mode.
export function documentFileKeys(doc, isStored = isOurBucketUrl) {
  const keys = new Set();
  const add = value => {
    if (typeof value === 'string' && isStored(value)) keys.add(objectKeyFromUrl(value));
  };
  add(doc?.URL);
  add(doc?.SignedUrl);
  add(doc?.CertificateUrl);
  for (const role of Array.isArray(doc?.Placeholders) ? doc.Placeholders : []) {
    for (const item of Array.isArray(role?.placeHolder) ? role.placeHolder : []) {
      for (const pos of Array.isArray(item?.pos) ? item.pos : []) {
        add(pos?.options?.response);
        add(pos?.options?.defaultValue);
      }
    }
  }
  return keys;
}

// The document or template `request` names, looked up first in every storage mode
// (a missing or archived one is OBJECT_NOT_FOUND), and who may read its files:
// - a template: a signed-in user whose session can read it (owner, shared team); every
//   client caller (reports, bulk send, prefill) is on a signed-in page;
// - a document with IsEnableOTP: a signed-in party, i.e. a session the document's ACL
//   lets read it (its creator and signers);
// - any other document: whoever holds its link. LeaseLynx never sets IsEnableOTP and its
//   signers sign and download with no session, so the docId is the credential, exactly
//   as for getDocument, whose afterFind signs the same files.
async function authorisedRecord(request, docId, templateId) {
  const className = docId ? 'contracts_Document' : 'contracts_Template';
  const id = docId || templateId;
  const record = await new Parse.Query(className)
    .equalTo('objectId', id)
    .notEqualTo('IsArchive', true)
    .first({ useMasterKey: true });
  if (!record) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  const json = record.toJSON();
  if (templateId || json.IsEnableOTP) {
    if (!(await isAuthenticated(request?.user))) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
    }
    const readable = await new Parse.Query(className)
      .equalTo('objectId', id)
      .first({ sessionToken: request.user.getSessionToken() });
    if (!readable) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'You are not a party to this document.'
      );
    }
  }
  return json;
}

export async function getSignedUrl(request) {
  try {
    const docId = request.params.docId || '';
    const templateId = request.params.templateId || '';
    const url = request.params.url;

    if (docId || templateId) {
      try {
        const record = await authorisedRecord(request, docId, templateId);
        // A record authorises its own files only (#12, #112): never sign or tokenise a
        // file it does not reference. Checked in every storage mode.
        const notItsFile = () =>
          new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            'File does not belong to this document.'
          );
        if (isLocalParseFileUrl(url, process.env.SERVER_URL)) {
          // S3 mode refuses here (presignedlocalUrl): no /files/ tokens over the bucket.
          if (!isLocalStorage()) return presignedlocalUrl(url);
          const isLocalFile = value => isLocalParseFileUrl(value, process.env.SERVER_URL);
          if (!documentFileKeys(record, isLocalFile).has(objectKeyFromUrl(url))) throw notItsFile();
          return presignedlocalUrl(url);
        }
        if (isOurBucketUrl(url)) {
          if (!documentFileKeys(record).has(objectKeyFromUrl(url))) throw notItsFile();
          return getPresignedUrl(url);
        }
        // data: URLs and external images are not ours to sign: returned unchanged.
        return url;
      } catch (err) {
        console.log('Err in presigned url', err);
        throw err;
      }
    } else {
      const isAuth = await isAuthenticated(request?.user);
      if (!isAuth) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
      }
      // Every client read names the document or template the file belongs to (#112).
      // A session by itself authorises no file, in either storage mode: local storage
      // used to mint a /files/ token here for any URL any signed-in user named.
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A document or template is required to access stored files.'
      );
    }
  } catch (err) {
    console.log('error in getsignedurl', err);
    const code = err.code || 400;
    const msg = err.message;
    const error = new Parse.Error(code, msg);
    throw error;
  }
}

// Function to generate a signed URL with JWT. Local storage only: with the S3 adapter,
// Parse's /files route would serve any bucket object through the server's own
// credentials, so a token here would bypass the private bucket.
export function getSignedLocalUrl(fileUrl, expirationTimeInSeconds) {
  if (!isLocalStorage()) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, LOCAL_TOKENS_DISABLED);
  }
  const secretKey = process.env.MASTER_KEY;
  const exp = expirationTimeInSeconds || 200;
  try {
    // Create the payload with the file URL and expiration time
    const payload = {
      fileUrl,
      exp: Math.floor(Date.now() / 1000) + exp, // Expiry time in seconds
    };

    // Generate the JWT token
    const token = jwt.sign(payload, secretKey);
    // Return the signed URL containing the token
    return `${fileUrl}?token=${token}`;
  } catch (err) {
    console.log('Err while siging local url', err);
    throw new Error('Invalid or expired token.');
  }
}

// `presignedlocalUrl` gives a local Parse file URL a JWT (local storage only; refused in
// S3 mode, as getSignedLocalUrl is) and returns any other URL unchanged.
export function presignedlocalUrl(signedUrl, expirationTimeInSeconds) {
  if (isLocalParseFileUrl(signedUrl, process.env.SERVER_URL)) {
    if (!isLocalStorage()) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, LOCAL_TOKENS_DISABLED);
    }
    const fileUrl = signedUrl.split('?')?.[0];
    const secretKey = process.env.MASTER_KEY;
    const exp = expirationTimeInSeconds || 200;
    try {
      // Create the payload with the file URL and expiration time
      const payload = {
        fileUrl,
        exp: Math.floor(Date.now() / 1000) + exp, // Expiry time in seconds
      };
      // Generate the JWT token
      const token = jwt.sign(payload, secretKey);
      // Return the signed URL containing the token
      return `${fileUrl}?token=${token}`;
    } catch (err) {
      throw new Error('Invalid or expired token.');
    }
  } else {
    return signedUrl;
  }
}

// Function to validate the signed URL
export async function validateSignedLocalUrl(signedUrl) {
  const urlParams = new URLSearchParams(signedUrl.split('?')[1]);
  const token = urlParams.get('token');
  try {
    if (!token) {
      throw new Error('No token provided.');
    }
    const secretKey = process.env.MASTER_KEY;
    // Now verify the token (validate signature and expiration automatically)
    const decoded = jwt.verify(token, secretKey);
    // Check if the file URL in the JWT matches the requested file URL
    const fileUrl = signedUrl.split('?')[0];
    if (decoded.fileUrl !== fileUrl) {
      throw new Error('Invalid file URL in token.');
    }
    // If the token is valid and not expired, return the file URL
    return signedUrl;
  } catch (error) {
    console.log('Error validating file', error.message);
    return 'Unauthorized';
  }
}
