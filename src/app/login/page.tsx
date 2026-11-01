import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SEED } from '@/db/seed';
import { currentSession } from '@/lib/auth/server';

export const metadata: Metadata = { title: 'Sign in · Tenant Ledger' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentSession()) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <main className="auth">
      <h1>Sign in</h1>
      {error === 'invalid' && (
        <p role="alert" className="error">
          That email and password combination is not recognised.
        </p>
      )}
      <form action="/api/auth/login" method="post" className="stack">
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <section className="demo-accounts">
        <h2>Demo accounts</h2>
        <ul>
          {Object.values(SEED).map(({ organisation, member }) => (
            <li key={member.email}>
              <strong>{organisation.name}</strong>: <code>{member.email}</code> /{' '}
              <code>{member.password}</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
