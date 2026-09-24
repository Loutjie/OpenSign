import crypto from 'node:crypto';

// A contact signs in by an emailed code (AuthLoginAsMail), never by password, so its
// password is random. It used to be the email address, which let anyone who knew a
// signer's email sign in as them.
const randomPassword = () => crypto.randomBytes(24).toString('hex');

// A _User made by cloud code for a contact or a team member. Only the master key may
// create a _User (accessGuards.js rejectSelfSignup), so every such account is created
// here, with it. `password` is for a team member an admin adds (adduser); a contact gets
// a random one.
export async function createUserAccount(
  { name, email, phone, password },
  { newUser = () => new (Parse.Object.extend('User'))() } = {}
) {
  const user = newUser();
  user.set('name', name);
  user.set('username', email);
  user.set('email', email);
  user.set('password', password || randomPassword());
  if (phone) {
    user.set('phone', phone);
  }
  return user.save(null, { useMasterKey: true });
}
