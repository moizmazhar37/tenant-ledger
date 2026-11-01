/**
 * Proves isolation below the route handlers, so it does not depend on a handler
 * remembering to filter. Two layers protect ledger entries and each is tested on its own:
 *
 *  1. The repository's explicit organisation_id filter, tested with RLS bypassed.
 *  2. Postgres row-level security, tested with raw SQL that has no filter at all.
 *
 * Removing either layer makes this file fail, even though the other layer would still
 * hide the data from users.
 */
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, getDb } from '@/db/client';
import { serverEnv } from '@/env';
import { SEED } from '@/db/seed';
import { ledgerRepository, TENANT_ROLE, TENANT_SETTING, withTenant } from '@/db/tenant';
import { postgresErrorCode, resetDatabaseBeforeEach } from './helpers';

resetDatabaseBeforeEach();

const { acme, globex } = SEED;
const acmeEntryIds = acme.entries.map((entry) => entry.id).sort();
const foreignEntry = globex.entries[0];

function ids(rows: Iterable<{ id: unknown }>): string[] {
  return [...rows].map((row) => String(row.id)).sort();
}

describe('tenant isolation at the query layer', () => {
  beforeAll(async () => {
    // The repository tests need a connection Postgres exempts from RLS (a superuser);
    // otherwise they would be testing RLS twice and the filter not at all.
    const [role] = await getDb().execute<{ rolsuper: boolean }>(
      sql`select rolsuper from pg_roles where rolname = current_user`,
    );
    if (!role?.rolsuper) {
      throw new Error('Isolation tests must connect as a superuser so RLS can be bypassed.');
    }
  });

  it('precondition: another tenant’s entry exists and is reachable when nothing scopes the query', async () => {
    // Without this, every "returns nothing" assertion below could pass vacuously.
    const rows = await getDb().execute(
      sql`select id from ledger_entries where id = ${foreignEntry.id}`,
    );
    expect(rows).toHaveLength(1);
  });

  describe('repository filter, with row-level security bypassed (breaks if the organisation_id filter is removed)', () => {
    const repo = () => ledgerRepository(getDb(), acme.organisation.id);

    it('findById does not return another organisation’s entry', async () => {
      expect(await repo().findById(foreignEntry.id)).toBeNull();
    });

    it('findById still returns the organisation’s own entry', async () => {
      const own = await repo().findById(acme.entries[0].id);
      expect(own?.organisationId).toBe(acme.organisation.id);
    });

    it('list returns exactly the organisation’s own entries', async () => {
      expect(ids(await repo().list())).toEqual(acmeEntryIds);
    });

    it('findByProviderEventId does not resolve another organisation’s event id', async () => {
      expect(await repo().findByProviderEventId(foreignEntry.providerEventId)).toBeNull();
    });

    it('totals include only the organisation’s own entries', async () => {
      // 1250.00 + 480.50 - 120.00, and no USD from the other tenant.
      expect(await repo().totals()).toEqual([{ currency: 'GBP', netMinor: 161050 }]);
    });
  });

  describe('row-level security, with no application filter at all (breaks if the policy is dropped or weakened)', () => {
    it('an unfiltered SELECT inside a tenant context sees only that tenant’s rows', async () => {
      const rows = await withTenant(getDb(), acme.organisation.id, (_ledger, tx) =>
        tx.execute<{ id: string }>(sql`select id from ledger_entries`),
      );
      expect(ids(rows)).toEqual(acmeEntryIds);
    });

    it('selecting another tenant’s row by primary key returns nothing', async () => {
      const rows = await withTenant(getDb(), acme.organisation.id, (_ledger, tx) =>
        tx.execute(sql`select * from ledger_entries where id = ${foreignEntry.id}`),
      );
      expect(rows).toHaveLength(0);
    });

    it('fails closed: under the tenant role with no organisation set, no rows are visible', async () => {
      const rows = await getDb().transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${TENANT_ROLE}`));
        return tx.execute(sql`select id from ledger_entries`);
      });
      expect(rows).toHaveLength(0);
    });

    it('rejects inserting a row for another organisation', async () => {
      const attempt = withTenant(getDb(), acme.organisation.id, (_ledger, tx) =>
        tx.execute(sql`
          insert into ledger_entries
            (organisation_id, provider_event_id, kind, amount_minor, currency, occurred_at)
          values
            (${globex.organisation.id}, 'evt_cross_tenant_write', 'payment', 100, 'USD', now())
        `),
      );
      // 42501: new row violates row-level security policy.
      await expect(attempt.catch(postgresErrorCode)).resolves.toBe('42501');
    });

    it('neither the role nor the organisation outlives the transaction on a pooled connection', async () => {
      // One connection, so the follow-up query is guaranteed to reuse it.
      const { db, client } = createDatabase(serverEnv().DATABASE_URL, { max: 1 });
      try {
        await withTenant(db, acme.organisation.id, async () => undefined);
        const [row] = await db.execute<{ setting: string | null; role: string }>(
          sql`select current_setting(${TENANT_SETTING}, true) as setting, current_user as role`,
        );
        expect(row?.setting ?? '').toBe('');
        expect(row?.role).not.toBe(TENANT_ROLE);
      } finally {
        await client.end();
      }
    });
  });

  it('withTenant refuses an organisation id that is not a UUID', async () => {
    await expect(withTenant(getDb(), "' or 1=1 --", async () => undefined)).rejects.toThrow(/UUID/);
  });
});
