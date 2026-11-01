import { and, desc, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { Database } from './client';
import * as schema from './schema';
import { ledgerEntries, type LedgerEntry, type NewLedgerEntry } from './schema';

/** Must match the role and setting names in drizzle/0001_tenant_row_level_security.sql. */
export const TENANT_ROLE = 'tenant_ledger_app';
export const TENANT_SETTING = 'app.current_organisation_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type Queryable = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export type NewEntryFromEvent = Omit<NewLedgerEntry, 'organisationId' | 'receivedAt'>;

export interface CurrencyTotal {
  currency: string;
  netMinor: number;
}

/**
 * Every query here filters on organisation_id explicitly. Row-level security enforces
 * the same rule underneath; each layer has its own tests so neither can silently rot.
 */
export function ledgerRepository(db: Queryable, organisationId: string) {
  const ownedBy = eq(ledgerEntries.organisationId, organisationId);

  return {
    async list(): Promise<LedgerEntry[]> {
      return db
        .select()
        .from(ledgerEntries)
        .where(ownedBy)
        .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id));
    },

    async findById(entryId: string): Promise<LedgerEntry | null> {
      // A malformed id cannot match any row; answering here avoids a cast error (500).
      if (!isUuid(entryId)) return null;
      const [row] = await db
        .select()
        .from(ledgerEntries)
        .where(and(ownedBy, eq(ledgerEntries.id, entryId)))
        .limit(1);
      return row ?? null;
    },

    async findByProviderEventId(providerEventId: string): Promise<LedgerEntry | null> {
      const [row] = await db
        .select()
        .from(ledgerEntries)
        .where(and(ownedBy, eq(ledgerEntries.providerEventId, providerEventId)))
        .limit(1);
      return row ?? null;
    },

    /**
     * Inserts unless an entry with this provider event id already exists, in any
     * organisation. Returns null when nothing was inserted. Concurrency-safe because
     * the decision is made by the unique constraint, not by a prior read.
     */
    async insertIfAbsent(entry: NewEntryFromEvent): Promise<LedgerEntry | null> {
      const [row] = await db
        .insert(ledgerEntries)
        .values({ ...entry, organisationId })
        .onConflictDoNothing({ target: ledgerEntries.providerEventId })
        .returning();
      return row ?? null;
    },

    async totals(): Promise<CurrencyTotal[]> {
      return db
        .select({
          currency: ledgerEntries.currency,
          netMinor: sql<number>`sum(case when ${ledgerEntries.kind} = 'payment'
            then ${ledgerEntries.amountMinor} else -${ledgerEntries.amountMinor} end)`.mapWith(
            Number,
          ),
        })
        .from(ledgerEntries)
        .where(ownedBy)
        .groupBy(ledgerEntries.currency)
        .orderBy(ledgerEntries.currency);
    },
  };
}

export type LedgerRepository = ReturnType<typeof ledgerRepository>;

/**
 * Runs `fn` in a transaction that has assumed the restricted tenant role with the
 * organisation pinned. Both settings are transaction-local, so they cannot leak to
 * the next user of a pooled connection.
 */
export async function withTenant<T>(
  db: Database,
  organisationId: string,
  fn: (ledger: LedgerRepository, tx: Queryable) => Promise<T>,
): Promise<T> {
  if (!isUuid(organisationId)) {
    throw new Error('withTenant requires an organisation UUID');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${TENANT_ROLE}`));
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${organisationId}, true)`);
    return fn(ledgerRepository(tx, organisationId), tx);
  });
}
