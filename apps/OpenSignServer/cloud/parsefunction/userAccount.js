// A _User made by cloud code for a contact or a team member. Only the master key may
// create a _User (accessGuards.js rejectSelfSignup), so every such account is created
// here, with it.
export async function createUserAccount(
  { name, email, phone, password },
  { newUser = () => new (Parse.Object.extend('User'))() } = {}
) {
  const user = newUser();
  user.set('name', name);
  user.set('username', email);
  user.set('email', email);
  user.set('password', password);
  if (phone) {
    user.set('phone', phone);
  }
  return user.save(null, { useMasterKey: true });
}
