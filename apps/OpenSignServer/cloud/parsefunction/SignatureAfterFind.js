import { resolveStoredUrl as resolveUrl } from './getSignedUrl.js';

async function SignatureAfterFind(request) {
  if (request.objects.length === 1) {
    if (request.objects) {
      const obj = request.objects[0];
      const ImageURL = obj?.get('ImageURL') && obj?.get('ImageURL');
      const Initials = obj?.get('Initials') && obj?.get('Initials');
      const Stamp = obj?.get('Stamp') && obj?.get('Stamp');
      if (ImageURL) obj.set('ImageURL', await resolveUrl(ImageURL));
      if (Initials) obj.set('Initials', await resolveUrl(Initials));
      if (Stamp) obj.set('Stamp', await resolveUrl(Stamp));
      return [obj];
    }
  }
}
export default SignatureAfterFind;
