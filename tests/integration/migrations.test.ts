/**
 * Applies every migration to a brand-new database and checks the result against what
 * the application is compiled against (src/db/schema.ts). This catches:
 *  - a schema change with no migration,
 *  - a migration file that is not registered in the journal, so it never runs,
 *  - a hand-written migration that silently loses a security property (RLS, uniqueness).
 */
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { introspectSchema, type IntrospectedSchema } from '@/db/introspect';
import * as schema from '@/db/schema';
import { TENANT_ROLE } from '@/db/tenant';
import { serverEnv } from '@/env';
import { withDatabaseName } from '../support/database';

const MIGRATIONS_FOLDER = 'drizzle';
const freshName = `tenant_ledger_migrations_${randomBytes(4).toString('hex')}_test`;

// Every table exported from the schema module, so a new table is covered automatically.
const tables: PgTable[] = Object.values(schema).flatMap((value) =>
  is(value, PgTable) ? [value as PgTable] : [],
);

/** Drizzle and Postgres spell a few types differently. */
function normaliseType(type: string): string {
  return type
    .replace(/^char\((\d+)\)$/, 'character($1)')
    .replace(/^varchar\((\d+)\)$/, 'character varying($1)')
    .replace(/^varchar$/, 'character varying');
}

describe('migrations from an empty database', () => {
  let admin: postgres.Sql;
  let fresh: postgres.Sql;
  let applied: IntrospectedSchema;

  beforeAll(async () => {
    const url = serverEnv().DATABASE_URL;
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${freshName}"`);
    fresh = postgres(withDatabaseName(url, freshName), { max: 1, onnotice: () => {} });

    const before = await introspectSchema(fresh);
    expect(before.tables, 'the database must start empty').toEqual([]);

    await migrate(drizzle(fresh), { migrationsFolder: MIGRATIONS_FOLDER });
    applied = await introspectSchema(fresh);
  });

  afterAll(async () => {
    await fresh?.end();
    await admin?.unsafe(`drop database if exists "${freshName}" with (force)`);
    await admin?.end();
  });

  it('applies every migration file on disk, each registered in the journal', async () => {
    const files = readdirSync(MIGRATIONS_FOLDER)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .sort();
    const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as {
      entries: { tag: string }[];
    };

    // Drizzle only runs migrations listed in the journal. A .sql file missing from it
    // is a migration that was written but will never be applied anywhere.
    expect(journal.entries.map((entry) => entry.tag).sort()).toEqual(files);

    const [row] = await fresh<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations`;
    expect(row?.count).toBe(files.length);
  });

  it('produces exactly the tables the application schema declares', () => {
    expect(applied.tables.map((t) => t.name).sort()).toEqual(
      tables.map((t) => getTableConfig(t).name).sort(),
    );
  });

  describe.each(
    tables.map((table) => [getTableConfig(table).name, getTableConfig(table)] as const),
  )('table %s', (tableName, config) => {
    const actual = () => {
      const table = applied.tables.find((t) => t.name === tableName);
      if (!table) throw new Error(`table ${tableName} was not created by any migration`);
      return table;
    };

    it('has exactly the declared columns, types, nullability and defaults', () => {
      const describeColumn = (c: {
        name: string;
        type: string;
        notNull: boolean;
        hasDefault: boolean;
      }) =>
        `${c.name} ${normaliseType(c.type)}${c.notNull ? ' not null' : ''}${c.hasDefault ? ' default' : ''}`;

      expect(
        actual()
          .columns.map((c) => describeColumn({ ...c, hasDefault: c.default !== null }))
          .sort(),
      ).toEqual(
        config.columns
          .map((c) =>
            describeColumn({
              name: c.name,
              type: c.getSQLType(),
              notNull: c.notNull,
              hasDefault: c.hasDefault,
            }),
          )
          .sort(),
      );
    });

    it('has every declared unique, foreign key and check constraint, and index', () => {
      const constraintNames = actual().constraints.map((c) => c.name);
      const indexNames = actual().indexes.map((i) => i.name);

      for (const unique of config.uniqueConstraints) {
        expect(constraintNames).toContain(unique.getName());
      }
      for (const column of config.columns.filter((c) => c.isUnique && c.uniqueName)) {
        expect(constraintNames).toContain(column.uniqueName);
      }
      for (const fk of config.foreignKeys) expect(constraintNames).toContain(fk.getName());
      for (const check of config.checks) expect(constraintNames).toContain(check.name);
      for (const index of config.indexes) expect(indexNames).toContain(index.config.name);
    });
  });

  it('creates every enum with the declared values in order', () => {
    expect(applied.enums).toEqual([
      { name: schema.entryKind.enumName, values: [...schema.entryKind.enumValues] },
    ]);
  });

  it('enforces webhook idempotency with a unique constraint on provider_event_id', () => {
    const ledger = applied.tables.find((t) => t.name === 'ledger_entries');
    expect(ledger?.constraints).toContainEqual({
      name: 'ledger_entries_provider_event_id_key',
      type: 'unique',
      definition: 'UNIQUE (provider_event_id)',
    });
  });

  it.each(schema.TENANT_SCOPED_TABLES)(
    'tenant-scoped table %s has row level security enabled, forced, and scoped to the tenant role',
    (tableName) => {
      const table = applied.tables.find((t) => t.name === tableName);
      expect(table?.rowLevelSecurity).toBe(true);
      expect(table?.forceRowLevelSecurity).toBe(true);
      expect(table?.policies).toHaveLength(1);
      const [policy] = table?.policies ?? [];
      expect(policy?.roles).toEqual([TENANT_ROLE]);
      expect(policy?.command).toBe('ALL');
      expect(policy?.using).toContain('app.current_organisation_id');
      expect(policy?.withCheck).toContain('app.current_organisation_id');
    },
  );
});
