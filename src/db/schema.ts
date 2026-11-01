import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique('organisations_slug_key'),
  name: text('name').notNull(),
  /** The account identifier the payment provider uses for this organisation. */
  providerAccountId: text('provider_account_id')
    .notNull()
    .unique('organisations_provider_account_id_key'),
  createdAt: createdAt(),
});

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique('members_email_key'),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('members_organisation_id_idx').on(t.organisationId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token. The raw token is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_member_id_idx').on(t.memberId)],
);

export const entryKind = pgEnum('entry_kind', ['payment', 'refund']);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    /** Idempotency key. The unique constraint, not application code, makes redelivery safe. */
    providerEventId: text('provider_event_id').notNull(),
    kind: entryKind('kind').notNull(),
    /** Always positive, in the currency's minor unit. Direction comes from `kind`. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    description: text('description').notNull().default(''),
    /** When the provider says the event happened. Ordering uses this, never arrival order. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('ledger_entries_provider_event_id_key').on(t.providerEventId),
    index('ledger_entries_organisation_occurred_idx').on(t.organisationId, t.occurredAt.desc()),
    check('ledger_entries_amount_positive', sql`${t.amountMinor} > 0`),
    check('ledger_entries_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Tables protected by row-level security. The policies live in a hand-written
 * migration; the migration test asserts every table listed here has them.
 */
export const TENANT_SCOPED_TABLES = ['ledger_entries'] as const;

export type Organisation = typeof organisations.$inferSelect;
export type Member = typeof members.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
