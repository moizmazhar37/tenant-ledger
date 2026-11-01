-- Tenant isolation enforced by Postgres, not by application code remembering a WHERE clause.
--
-- Request-scoped work runs inside a transaction that does
--   SET LOCAL ROLE tenant_ledger_app;
--   SELECT set_config('app.current_organisation_id', '<uuid>', true);
-- (see src/db/tenant.ts). Under that role, ledger_entries only exposes rows for the
-- current organisation and rejects writes for any other. If the setting is missing the
-- policy matches nothing, so a forgotten tenant context fails closed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_ledger_app') THEN
    CREATE ROLE tenant_ledger_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Lets a non-superuser migration role (e.g. a managed Postgres owner) assume the tenant role.
GRANT tenant_ledger_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tenant_ledger_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE ledger_entries TO tenant_ledger_app;
--> statement-breakpoint
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- FORCE applies the policy to the table owner too, so only superusers bypass it.
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ledger_entries_tenant_isolation ON ledger_entries
  AS PERMISSIVE
  FOR ALL
  TO tenant_ledger_app
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
