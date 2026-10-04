// createUserAccount returned the saved _User instance, which still carries the password
// it was saved with; callers set it as a pointer field and returned the row as JSON. So
// savecontact handed a landlord the new contact's random password (a login as that
// signer), and adduser echoed the chosen one. Called over REST with a real session.
import { logIn, makeUser, pointer, rest, uniq } from './utils/rest.js';

describe('no cloud function returns a password', () => {
  const tag = uniq();
  let landlord;

  beforeAll(async () => {
    landlord = await makeUser(`pw-landlord-${tag}@x.test`);
    await rest('POST', '/classes/contracts_Users', {
      master: true,
      body: {
        UserId: pointer('_User', landlord.id),
        UserRole: 'contracts_Admin',
        Email: landlord.email,
        TenantId: pointer('partners_Tenant', `pwTenant${tag}`),
      },
    });
    // savecontact queries contracts_Contactbook with the caller's session, and clients may
    // not create classes: make sure the class exists when this spec runs alone.
    await rest('POST', '/classes/contracts_Contactbook', {
      master: true,
      body: { Name: 'seed', Email: `seed-${tag}@x.test`, UserId: pointer('_User', landlord.id), IsDeleted: true },
    });
  });

  it('savecontact returns the contact without its new account\'s password', async () => {
    const res = await rest('POST', '/functions/savecontact', {
      session: landlord.session,
      body: { name: 'New Tenant', email: `pw-contact-${tag}@x.test`, tenantId: `pwTenant${tag}` },
    });
    expect(res.status).withContext(JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.Email).toBe(`pw-contact-${tag}@x.test`);
    expect(res.body.result.UserId?.objectId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('the contact account still exists and nobody was told a password for it', async () => {
    const users = await rest('GET', `/users?where=${encodeURIComponent(JSON.stringify({ email: `pw-contact-${tag}@x.test` }))}`, { master: true });
    expect(users.body.results.length).toBe(1);
    expect(await logIn(`pw-contact-${tag}@x.test`, '')).toBeNull();
  });
});
