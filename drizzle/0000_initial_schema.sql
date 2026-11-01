CREATE TYPE "public"."entry_kind" AS ENUM('payment', 'refund');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_provider_event_id_key" UNIQUE("provider_event_id"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_minor" > 0),
	CONSTRAINT "ledger_entries_currency_format" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_key" UNIQUE("slug"),
	CONSTRAINT "organisations_provider_account_id_key" UNIQUE("provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_organisation_occurred_idx" ON "ledger_entries" USING btree ("organisation_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "members_organisation_id_idx" ON "members" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "sessions_member_id_idx" ON "sessions" USING btree ("member_id");