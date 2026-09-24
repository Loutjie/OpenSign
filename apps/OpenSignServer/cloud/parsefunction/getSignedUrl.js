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

const isOurBucketUrl = url =>
  isBucketUrl(url, process.env.DO_SPACE, makeEndpoint(process.env.DO_ENDPOINT));

// `getPresignedUrl` returns a readable URL for a stored file: a JWT-carrying URL for a
// local Parse file (local storage only), a fresh signature for an object in our bucket,
// and any other URL (data: URLs, external images) unchanged.
export default async function getPresignedUrl(url) {
  if (isLocalParseFileUrl(url, process.env.SERVER_URL)) return presignedlocalUrl(url);
  if (!isOurBucketUrl(url)) return url;
  const command = new GetObjectCommand({
    Bucket: process.env.DO_SPACE,
    Key: objectKeyFromUrl(url),
  });
  return presign(makeS3Client(), command, { expiresIn: READ_URL_TTL_SECONDS });
}

// `documentFileKeys` returns the object keys of every bucket file a contracts_Document
// (or contracts_Template) references: its PDF, signed PDF, certificate, and every
// placeholder image (`options.response` or `options.defaultValue`) of every role, the
// shape Utils.js `handleValidImage` walks. Anything not in our bucket is skipped.
export function documentFileKeys(doc) {
  const keys = new Set();
  const add = value => {
    if (typeof value === 'string' && isOurBucketUrl(value)) keys.add(objectKeyFromUrl(value));
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

export async function getSignedUrl(request) {
  try {
    const docId = request.params.docId || '';
    const templateId = request.params.templateId || '';
    const url = request.params.url;

    if (docId || templateId) {
      try {
        if (isLocalParseFileUrl(url, process.env.SERVER_URL)) {
          return presignedlocalUrl(url);
        } else if (!isLocalStorage()) {
          const query = new Parse.Query(docId ? 'contracts_Document' : 'contracts_Template');
          query.equalTo('objectId', docId ? docId : templateId);
          query.include('ExtUserPtr.TenantId');
          query.notEqualTo('IsArchive', true);
          const res = await query.first({ useMasterKey: true });
          if (!res) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');

          const _resDoc = res?.toJSON();
          // Ensure user is authenticated if OTP is required
          if (_resDoc?.IsEnableOTP) {
            const isAuth = await isAuthenticated(request?.user);
            if (!isAuth) {
              throw new Parse.Error(
                Parse.Error.INVALID_SESSION_TOKEN,
                'User is not authenticated.'
              );
            }
          }

          // A document link authorises that document's files only (#12): never sign a
          // key the document does not reference.
          if (isOurBucketUrl(url) && !documentFileKeys(_resDoc).has(objectKeyFromUrl(url))) {
            throw new Parse.Error(
              Parse.Error.OPERATION_FORBIDDEN,
              'File does not belong to this document.'
            );
          }

          const presignedUrl = await getPresignedUrl(url);
          return presignedUrl;
        } else {
          return url;
        }
      } catch (err) {
        console.log('Err in presigned url', err);
        throw err;
      }
    } else {
      const isAuth = await isAuthenticated(request?.user);
      if (!isAuth) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
      } else {
        if (isLocalParseFileUrl(url, process.env.SERVER_URL)) {
          return presignedlocalUrl(url);
        } else if (!isLocalStorage()) {
          const presignedUrl = await getPresignedUrl(url);
          return presignedUrl;
        } else {
          return url;
        }
      }
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
