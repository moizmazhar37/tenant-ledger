import { hashPassword } from '@/lib/auth/password';
import type { Database } from './client';
import { members, organisations } from './schema';
import { withTenant, type NewEntryFromEvent } from './tenant';

/**
 * Two organisations with deliberately distinct data (different currencies, amounts and
 * descriptions) so an isolation failure is visible rather than coincidentally passing.
 * Ids are fixed so tests can reference them directly.
 */
export const SEED = {
  acme: {
    organisation: {
      id: 'a0000000-0000-4000-8000-000000000000',
      slug: 'acme',
      name: 'Acme Ltd',
      providerAccountId: 'acct_acme',
    },
    member: {
      id: 'a1000000-0000-4000-8000-000000000001',
      email: 'ada@acme.test',
      name: 'Ada Lovelace',
      password: 'acme-demo-password',
    },
    entries: [
      {
        id: 'ae000000-0000-4000-8000-000000000001',
        providerEventId: 'evt_seed_acme_0001',
        kind: 'payment',
        amountMinor: 125000,
        currency: 'GBP',
        description: 'Acme invoice INV-1001',
        occurredAt: new Date('2026-10-01T09:30:00Z'),
      },
      {
        id: 'ae000000-0000-4000-8000-000000000002',
        providerEventId: 'evt_seed_acme_0002',
        kind: 'payment',
        amountMinor: 48050,
        currency: 'GBP',
        description: 'Acme invoice INV-1002',
        occurredAt: new Date('2026-10-08T14:05:00Z'),
      },
      {
        id: 'ae000000-0000-4000-8000-000000000003',
        providerEventId: 'evt_seed_acme_0003',
        kind: 'refund',
        amountMinor: 12000,
        currency: 'GBP',
        description: 'Acme partial refund INV-1001',
        occurredAt: new Date('2026-10-12T11:00:00Z'),
      },
    ],
  },
  globex: {
    organisation: {
      id: 'b0000000-0000-4000-8000-000000000000',
      slug: 'globex',
      name: 'Globex Corporation',
      providerAccountId: 'acct_globex',
    },
    member: {
      id: 'b1000000-0000-4000-8000-000000000001',
      email: 'grace@globex.test',
      name: 'Grace Hopper',
      password: 'globex-demo-password',
    },
    entries: [
      {
        id: 'be000000-0000-4000-8000-000000000001',
        providerEventId: 'evt_seed_globex_0001',
        kind: 'payment',
        amountMinor: 990000,
        currency: 'USD',
        description: 'Globex annual contract GBX-77',
        occurredAt: new Date('2026-09-20T16:45:00Z'),
      },
      {
        id: 'be000000-0000-4000-8000-000000000002',
        providerEventId: 'evt_seed_globex_0002',
        kind: 'payment',
        amountMinor: 15999,
        currency: 'USD',
        description: 'Globex support add-on GBX-78',
        occurredAt: new Date('2026-10-15T08:20:00Z'),
      },
    ],
  },
} as const satisfies Record<
  string,
  {
    organisation: typeof organisations.$inferInsert;
    member: { id: string; email: string; name: string; password: string };
    entries: readonly (NewEntryFromEvent & { id: string })[];
  }
>;

/** Idempotent: safe to run repeatedly against the same database. */
export async function seedDatabase(db: Database): Promise<void> {
  for (const tenant of Object.values(SEED)) {
    await db.insert(organisations).values(tenant.organisation).onConflictDoNothing();
    const { password, ...member } = tenant.member;
    await db
      .insert(members)
      .values({
        ...member,
        organisationId: tenant.organisation.id,
        passwordHash: await hashPassword(password),
      })
      .onConflictDoNothing();
    // Entries go through the tenant boundary like any other write, so seeding also
    // works where row-level security applies to the connecting role.
    await withTenant(db, tenant.organisation.id, async (ledger) => {
      for (const entry of tenant.entries) await ledger.insertIfAbsent(entry);
    });
  }
}
