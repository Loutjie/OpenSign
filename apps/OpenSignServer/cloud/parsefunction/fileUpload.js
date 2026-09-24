import { getSignedLocalUrl, isLocalStorage } from './getSignedUrl.js';
import { isLocalParseFileUrl } from './storedFileUrl.js';

// `fileupload` gives a just-uploaded local Parse file a JWT. In S3 mode a URL that is
// not a local Parse file (a bucket URL, which older clients still send after every
// upload) comes back unchanged with no token; a local Parse URL is refused by
// getSignedLocalUrl, since the /files/ route would serve the bucket (#12).
export default async function fileUpload(request) {
  const url = request.params.url;

  if (!isLocalStorage() && !isLocalParseFileUrl(url, process.env.SERVER_URL)) {
    return { url };
  }
  try {
    const urlwithjwt = getSignedLocalUrl(url, 200);
    return { url: urlwithjwt };
  } catch (err) {
    console.log('Err ', err);
    throw err;
  }
}
