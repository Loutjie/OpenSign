// The server issues six-digit OTPs. Native form validation must let each live
// OpenSign verification route submit the code it actually emails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const files = [
  './GuestLogin.jsx',
  './UserProfile.jsx',
  '../components/pdf/VerifyEmail.jsx',
];

describe('OTP input contract', () => {
  it.each(files)('%s accepts a six-digit code', relative => {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    expect(source).toContain('pattern="[0-9]{6}"');
    expect(source).not.toContain('pattern="[0-9]{4}"');
  });
});
