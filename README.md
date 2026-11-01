# tenant-ledger

[![CI](https://github.com/moizmazhar37/tenant-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/moizmazhar37/tenant-ledger/actions/workflows/ci.yml)

A deliberately small multi-tenant ledger, built to show CI discipline rather than features.
Organisations have members and ledger entries. A webhook receives payment events from a
simulated provider and records them against the right organisation. Members see a dashboard
of their own organisation's entries and a detail page per entry.

Most of the repository is the test suite and the CI around it. It makes three claims, and
each one is proven by tests that fail when the thing they guard is removed:

1. **Tenant isolation.** A member of one organisation can never read another organisation's
   entries, and this does not depend on a route handler remembering to filter.
2. **Webhook idempotency.** One provider event creates exactly one ledger entry, however many
   times and in whatever order it arrives. The guarantee comes from a database constraint.
3. **Migrations.** Applying every migration to an empty database produces exactly the schema
   the application is compiled against.

Stack: Next.js 16 (App Router, TypeScript strict), PostgreSQL 18 with Drizzle ORM, Vitest,
Playwright, GitHub Actions.

## How it works

### The tenant boundary

Ledger entries are protected by two independent layers:

- **The repository** in [`src/db/tenant.ts`](src/db/tenant.ts) is the only code allowed to query
  `ledger_entries`. An ESLint rule rejects imports of the table anywhere else, and every query
  the repository builds filters on `organisation_id`.
- **Postgres row-level security**, added in a hand-written migration
  ([`0001_tenant_row_level_security.sql`](drizzle/0001_tenant_row_level_security.sql)).
  `withTenant()` opens a transaction, switches to a restricted role, and pins the
  organisation in a transaction-local setting. Under that role the table only exposes and
  accepts rows for that organisation. With no organisation set, it exposes nothing.

The organisation comes from the session's member row, never from the request. Another
organisation's entry and a nonexistent id get the same 404, so responses do not reveal that an
id exists elsewhere.

### The webhook

`POST /api/webhooks/payments` verifies an HMAC signature over the raw body with a five-minute
timestamp tolerance, validates the payload, finds the organisation by provider account id, and
inserts with `ON CONFLICT (provider_event_id) DO NOTHING`. The unique constraint decides
whether a delivery is new, so concurrent redeliveries cannot both win.

| Delivery                                        | Response                       |
| ----------------------------------------------- | ------------------------------ |
| New event                                       | `201 created`                  |
| Same event again                                | `200 duplicate`, same id       |
| Same event id, different amount or other tenant | `409 event_conflict`           |
| Bad, missing or expired signature               | `401 invalid_signature`        |
| Malformed JSON or invalid payload               | `400`, with the bad fields     |
| Unknown provider account                        | `422 unknown_account`          |
| Well-formed event of a type we don't handle     | `200 ignored`                  |
| Unexpected error                                | `500`, so the provider retries |

The codes follow the provider's retry semantics. 2xx stops retries, 4xx marks a delivery we
will never accept, and 5xx asks for a retry.

## Running locally

Prerequisites: Node 24 (see `.nvmrc`) and Docker.

```bash
npm ci
cp .env.example .env.local
docker compose up -d            # Postgres 18 on :5432, plus a tenant_ledger_test database
npm run db:migrate
npm run db:seed                 # two organisations with distinct data; idempotent
npm run dev                     # http://localhost:3000
```

Sign in with either seeded account (the login page lists them too):

| Organisation             | Email               | Password               |
| ------------------------ | ------------------- | ---------------------- |
| Acme Ltd (GBP)           | `ada@acme.test`     | `acme-demo-password`   |
| Globex Corporation (USD) | `grace@globex.test` | `globex-demo-password` |

To play the payment provider, send a signed event to the running app:

```bash
npm run webhook:send -- --account acct_acme --amount 2500 --id evt_demo_1
npm run webhook:send -- --account acct_acme --amount 2500 --id evt_demo_1   # 200 duplicate
```

`--url` points it at another deployment, and the secret comes from `WEBHOOK_SECRET`.

## Running the tests

The database-backed suites read `.env.test`, which points at the `tenant_ledger_test` database
that docker-compose creates. They truncate tables, so they refuse to run against any database
whose name does not end in `_test`. Environment variables override `.env.test`; that is how CI
points them at its own container.

| Suite                     | Command                                                     | Needs Postgres |
| ------------------------- | ----------------------------------------------------------- | -------------- |
| Unit                      | `npm run test:unit`                                         | no             |
| Integration               | `npm run test:integration`                                  | yes            |
| Unit and integration      | `npm test`                                                  | yes            |
| End-to-end (Playwright)   | `npm run build && npm run test:e2e`                         | yes            |
| Migration schema snapshot | `npm run db:snapshot:check`                                 | yes            |
| Lint, format, types       | `npm run lint && npm run format:check && npm run typecheck` | no             |

Before the first end-to-end run, install the browser with `npx playwright install chromium`.
Playwright starts the production build (`next start` on port 3100), not the dev server, so run
`npm run build` after changing app code. When a run fails, `npx playwright show-report` opens
the HTML report with traces.

### What each suite covers

- **Unit** ([`tests/unit`](tests/unit)): signature verification, including tampering, wrong
  secret, both edges of the tolerance window and secret rotation. Event parsing, minor-unit
  money formatting for currencies with zero or three decimals, and password hashing.
- **Tenant isolation, API layer**
  ([`tenant-isolation.api.test.ts`](tests/integration/tenant-isolation.api.test.ts)): calls the
  real route handlers as each tenant. Another tenant's entry is a 404 whose body matches a
  nonexistent id and contains none of the record. Also covers missing, forged and expired
  sessions.
- **Tenant isolation, query layer**
  ([`tenant-isolation.query.test.ts`](tests/integration/tenant-isolation.query.test.ts)): tests
  each layer alone. The repository filter is tested over a superuser connection, which Postgres
  exempts from RLS. The RLS policy is tested with raw SQL that has no `WHERE` clause. Also covers
  fail-closed behaviour, rejected cross-tenant writes, and no leakage of role or setting across
  pooled connections. A precondition test makes sure the other tenant's row is reachable when
  nothing scopes the query, so the "returns nothing" assertions cannot pass vacuously.
- **Webhook idempotency**
  ([`webhook-idempotency.test.ts`](tests/integration/webhook-idempotency.test.ts)): redelivery,
  10 concurrent deliveries of one event, redelivery after the connection pool is torn down,
  out-of-order events (including a refund before its payment), conflicting reuse of an event
  id within and across tenants, 15 malformed payload shapes, 4 signature failures, unknown
  accounts and unsupported types. Every rejection asserts that zero rows were written. A raw
  duplicate insert that bypasses the handler raises `23505`, showing the guarantee is in the
  schema.
- **Migrations** ([`migrations.test.ts`](tests/integration/migrations.test.ts)): creates a new
  database, applies every migration, and compares the result with the Drizzle schema: tables,
  columns, types, nullability, defaults, constraints, indexes and enums. Tables are discovered
  from the schema module, so new ones are covered automatically. It also requires every `.sql`
  file to be registered in the journal, because Drizzle silently skips one that is not, and it
  checks the RLS and uniqueness properties that the hand-written migration is responsible for.
- **End-to-end** ([`e2e`](e2e)): every page as a signed-in member and as an anonymous visitor.
  Rendered pages must return 200, show their heading, and log no console errors or uncaught
  exceptions. Protected pages must redirect to `/login`. The first test discovers `page.tsx`
  files under `src/app` and fails if a page has no route spec. Isolation is checked again in the
  browser, in both directions.

### Each guard was checked by breaking what it guards

| Change                                                  | Result                                  |
| ------------------------------------------------------- | --------------------------------------- |
| Remove the `organisation_id` filter from the repository | 4 query-layer tests fail                |
| Disable row-level security on `ledger_entries`          | 4 RLS tests fail                        |
| Drop the unique constraint on `provider_event_id`       | the webhook suite fails                 |
| Add a column to `schema.ts` without a migration         | the migration column test fails         |
| Add a migration file that is not in the journal         | the migration journal test fails        |
| Add a migration statement without updating the snapshot | `db:snapshot:check` fails with the diff |
| Add a page without a route spec                         | the e2e coverage test fails             |

## What is tested and what is not

I do not test third-party behaviour. Next.js routing, Drizzle's query builder, Postgres itself
and the payment provider are someone else's responsibility, and re-testing them adds run time
without adding confidence.

External providers are mocked at my own boundary, not inside their SDKs. The webhook tests build
the exact HTTP requests the provider would send and run them through the real route handler and a
real database. They assert my handling of every response shape the provider can produce: first
delivery, duplicate delivery, concurrent duplicates, out-of-order delivery, conflicting reuse of
an id, malformed and invalid payloads, bad signatures, unknown accounts and event types I don't
handle.

I do not snapshot-test presentational UI. A suite that fails on cosmetic changes trains people to
update snapshots without reading them, and then to ignore the suite. The end-to-end tests assert
behaviour instead: a page renders, shows the right data, hides the wrong data, and redirects
when it should. (The schema snapshot in `drizzle/` is not a UI snapshot. It is the effective
database schema, reviewed as a diff next to the migration that changed it.)

The tests target the places where being wrong is expensive and silent:

- **Money paths.** A double-recorded payment or a mis-scaled amount produces no error. It just
  makes the ledger wrong.
- **Permission boundaries.** A tenant leak returns a 200 with someone else's data, which looks
  exactly like success.
- **Migrations.** A migration that was written but never applied, or a schema change that never
  got a migration, works on the laptop that has it and fails in production.

Not tested, deliberately: visual layout, the login flow beyond its boundary (this is
demonstration auth: scrypt passwords and an httpOnly cookie, not a production identity
provider), performance and load, and the real provider's behaviour.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes
to `main`:

| Job         | What it does                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `lint`      | ESLint with `--max-warnings=0`, then `prettier --check`                                              |
| `typecheck` | `next typegen && tsc --noEmit`                                                                       |
| `test`      | Applies migrations to a Postgres 18 service container, then runs Vitest                              |
| `e2e`       | Builds the app, runs Playwright against it with its own Postgres, uploads the HTML report on failure |
| `build`     | `next build` with no database or secrets available                                                   |

The jobs have no dependencies between them, so each fails on its own and one failure never
hides another. Nothing is allowed to pass as a warning: lint warnings fail, Playwright has
retries off and `forbidOnly` on, and steps run under bash with `pipefail`. npm, the Playwright
browser (keyed on its exact version) and `.next/cache` are cached.

[`.github/workflows/migration-check.yml`](.github/workflows/migration-check.yml) runs only on
pull requests that touch `drizzle/`. On a fresh database it runs `drizzle-kit check`, fails if
`src/db/schema.ts` has changes with no migration, applies every migration, and fails with a
diff if the resulting schema no longer matches the committed
[`drizzle/schema-snapshot.txt`](drizzle/schema-snapshot.txt).

### Changing the schema

```bash
# edit src/db/schema.ts
npm run db:generate -- --name=describe_the_change   # writes the migration
npm run db:migrate
npm run db:snapshot                                  # regenerates drizzle/schema-snapshot.txt
git add drizzle src/db/schema.ts
```

For changes Drizzle cannot express, such as policies or roles, use
`npm run db:generate -- --custom --name=...` and write the SQL by hand. If the change affects
tenant scoping, list the table in `TENANT_SCOPED_TABLES` so the migration test checks it.

## Deploying to Vercel

1. Import the repository in Vercel. The Next.js preset is detected automatically.
2. Add a Postgres database from the Vercel Marketplace (Neon). It sets `DATABASE_URL` (pooled)
   and `DATABASE_URL_UNPOOLED`.
3. Add a `WEBHOOK_SECRET` environment variable of at least 16 characters.
4. Deploy. Vercel runs the `vercel-build` script, which applies migrations over the unpooled
   connection and then runs `next build`, so a deploy that cannot migrate fails instead of
   running against an old schema.
5. Seed the demo data once, then send it an event:

   ```bash
   npx vercel env pull .env.production.local
   NODE_ENV=production npm run db:seed
   NODE_ENV=production npm run webhook:send -- --url https://<your-app>.vercel.app/api/webhooks/payments
   ```

At runtime the app connects through the pooler with prepared statements disabled. The tenant
role and organisation setting are transaction-local, so they are safe under transaction-mode
pooling.

## Layout

```
src/app/                 pages and route handlers
src/db/schema.ts         Drizzle schema (the application's view of the database)
src/db/tenant.ts         the tenant boundary: withTenant() and the ledger repository
src/lib/webhooks/        signature verification, payload parsing, the idempotent handler
drizzle/                 migrations, Drizzle's metadata, and the committed schema snapshot
scripts/                 migrate, seed, schema snapshot, simulated provider
tests/unit/              pure logic, no I/O
tests/integration/       real Postgres: isolation, idempotency, migrations
e2e/                     Playwright against the production build
```
