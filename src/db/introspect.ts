import type { Sql } from 'postgres';

/**
 * Reads the public schema of a live database into a stable, comparable shape. Used by
 * the migration test and by the committed schema snapshot that CI diffs against.
 * Not-null constraints are read from pg_attribute rather than pg_constraint so the
 * output is the same on Postgres 17 and 18.
 */
export interface IntrospectedSchema {
  enums: { name: string; values: string[] }[];
  tables: {
    name: string;
    rowLevelSecurity: boolean;
    forceRowLevelSecurity: boolean;
    columns: { name: string; type: string; notNull: boolean; default: string | null }[];
    constraints: { name: string; type: string; definition: string }[];
    indexes: { name: string; definition: string }[];
    policies: {
      name: string;
      permissive: string;
      roles: string[];
      command: string;
      using: string | null;
      withCheck: string | null;
    }[];
    grants: { grantee: string; privileges: string }[];
  }[];
}

const CONSTRAINT_TYPES: Record<string, string> = {
  p: 'primary key',
  u: 'unique',
  f: 'foreign key',
  c: 'check',
};

export async function introspectSchema(sql: Sql): Promise<IntrospectedSchema> {
  const enums = await sql<{ name: string; values: string[] }[]>`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname`;

  const tables = await sql<{ name: string; rls: boolean; forceRls: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as "forceRls"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;

  const columns = await sql<
    { table: string; name: string; type: string; notNull: boolean; default: string | null }[]
  >`
    select c.relname as table, a.attname as name,
           format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as "notNull",
           pg_get_expr(d.adbin, d.adrelid) as default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`;

  const constraints = await sql<
    { table: string; name: string; type: string; definition: string }[]
  >`
    select c.relname as table, k.conname as name, k.contype as type,
           pg_get_constraintdef(k.oid) as definition
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and k.contype in ('p', 'u', 'f', 'c')
    order by c.relname, k.conname`;

  const indexes = await sql<{ table: string; name: string; definition: string }[]>`
    select tablename as table, indexname as name, indexdef as definition
    from pg_indexes
    where schemaname = 'public'
    order by tablename, indexname`;

  const policies = await sql<
    {
      table: string;
      name: string;
      permissive: string;
      roles: string[];
      command: string;
      using: string | null;
      withCheck: string | null;
    }[]
  >`
    select tablename as table, policyname as name, permissive,
           roles::text[] as roles, cmd as command, qual as using, with_check as "withCheck"
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname`;

  // Only privileges granted to roles other than the owner are interesting here.
  const grants = await sql<{ table: string; grantee: string; privileges: string }[]>`
    select g.table_name as table, g.grantee,
           string_agg(g.privilege_type, ', ' order by g.privilege_type) as privileges
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
    where g.table_schema = 'public' and g.grantee <> pg_get_userbyid(c.relowner)
    group by g.table_name, g.grantee
    order by g.table_name, g.grantee`;

  return {
    enums: enums.map(({ name, values }) => ({ name, values: [...values] })),
    tables: tables.map((table) => ({
      name: table.name,
      rowLevelSecurity: table.rls,
      forceRowLevelSecurity: table.forceRls,
      columns: columns
        .filter((c) => c.table === table.name)
        .map(({ name, type, notNull, default: def }) => ({ name, type, notNull, default: def })),
      constraints: constraints
        .filter((c) => c.table === table.name)
        .map(({ name, type, definition }) => ({
          name,
          type: CONSTRAINT_TYPES[type] ?? type,
          definition,
        })),
      indexes: indexes
        .filter((i) => i.table === table.name)
        .map(({ name, definition }) => ({ name, definition })),
      policies: policies
        .filter((p) => p.table === table.name)
        .map((p) => ({
          name: p.name,
          permissive: p.permissive,
          roles: [...p.roles],
          command: p.command,
          using: p.using,
          withCheck: p.withCheck,
        })),
      grants: grants
        .filter((g) => g.table === table.name)
        .map(({ grantee, privileges }) => ({ grantee, privileges })),
    })),
  };
}

/** Line-oriented rendering so a drift shows up as a readable diff in review. */
export function renderSchema(schema: IntrospectedSchema): string {
  const lines = ['# Generated by `npm run db:snapshot`. Do not edit by hand.', ''];
  for (const e of schema.enums) lines.push(`enum ${e.name}: ${e.values.join(', ')}`);
  for (const t of schema.tables) {
    const rls = t.rowLevelSecurity
      ? ` [row level security${t.forceRowLevelSecurity ? ', forced' : ''}]`
      : '';
    lines.push('', `table ${t.name}${rls}`);
    for (const c of t.columns) {
      const def = c.default === null ? '' : ` default ${c.default}`;
      lines.push(`  column ${c.name} ${c.type}${c.notNull ? ' not null' : ''}${def}`);
    }
    for (const k of t.constraints) lines.push(`  ${k.type} ${k.name}: ${k.definition}`);
    for (const i of t.indexes) lines.push(`  index ${i.name}: ${i.definition}`);
    for (const p of t.policies) {
      lines.push(
        `  policy ${p.name}: ${p.permissive} ${p.command} to ${p.roles.join(', ')}`,
        `    using ${p.using ?? '-'}`,
        `    with check ${p.withCheck ?? '-'}`,
      );
    }
    for (const g of t.grants) lines.push(`  grant to ${g.grantee}: ${g.privileges}`);
  }
  return `${lines.join('\n')}\n`;
}
