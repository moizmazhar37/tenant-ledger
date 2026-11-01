import Link from 'next/link';
import type { SessionContext } from '@/lib/auth/session';

export function AppHeader({ session }: { session: SessionContext }) {
  return (
    <header className="app-header">
      <Link href="/dashboard" className="brand">
        Tenant Ledger
      </Link>
      <div className="who">
        <span data-testid="organisation-name">{session.organisationName}</span>
        <span className="muted">{session.memberName}</span>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="link-button">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
