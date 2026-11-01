import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapler', stored)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it.each(['', 'plaintext', 'bcrypt$10$abc', 'scrypt$16384$8$1$salt'])(
    'treats a malformed stored hash %j as a failed match',
    async (stored) => {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    },
  );
});
