import { resolveStoredUrl as resolveUrl } from './getSignedUrl.js';

async function UserAfterFind(request) {
  if (request.objects.length === 1) {
    if (request.objects) {
      const obj = request.objects[0];
      const ProfilePic = obj?.get('ProfilePic') && obj?.get('ProfilePic');
      if (ProfilePic) obj.set('ProfilePic', await resolveUrl(ProfilePic));
      return [obj];
    }
  }
}
export default UserAfterFind;
