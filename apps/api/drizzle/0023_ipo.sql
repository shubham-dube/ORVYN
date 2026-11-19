CREATE TABLE "ipo_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"issue_id" uuid,
	"day" text NOT NULL,
	"reason" text NOT NULL,
	"value" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"category" text NOT NULL,
	"lots" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"allotted_lots" integer,
	"sold_price" double precision,
	"sale_costs_minor" bigint DEFAULT 0 NOT NULL,
	"share_minor" bigint,
	"reported_by" text DEFAULT 'owner' NOT NULL,
	"applied_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"open_date" text,
	"close_date" text,
	"allotment_date" text,
	"refund_date" text,
	"listing_date" text,
	"price_min" double precision,
	"price_max" double precision,
	"lot_size" integer,
	"issue_size_cr" double precision,
	"gmp" double precision,
	"gmp_updated_at" timestamp with time zone,
	"subscription" jsonb,
	"listing_price" double precision,
	"source" text NOT NULL,
	"source_url" text,
	"manual" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"source_id" uuid,
	"partner_id" uuid,
	"round_id" uuid,
	"application_id" uuid,
	"direction" text DEFAULT 'in' NOT NULL,
	"method" text DEFAULT 'UPI' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"for_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"upi" text DEFAULT '' NOT NULL,
	"relation" text DEFAULT '' NOT NULL,
	"categories" jsonb DEFAULT '["retail"]'::jsonb NOT NULL,
	"share" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"gmp" double precision,
	"subscription" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"fee_pct" double precision DEFAULT 0 NOT NULL,
	"repay" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipo_stars" (
	"owner_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_stars_owner_id_issue_id_pk" PRIMARY KEY("owner_id","issue_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_alerts_reason_uq" ON "ipo_alerts" USING btree ("owner_id","reason");--> statement-breakpoint
CREATE INDEX "ipo_alerts_day_idx" ON "ipo_alerts" USING btree ("owner_id","day");--> statement-breakpoint
CREATE INDEX "ipo_applications_round_idx" ON "ipo_applications" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_applications_partner_uq" ON "ipo_applications" USING btree ("round_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_issues_slug_uq" ON "ipo_issues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ipo_issues_status_idx" ON "ipo_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ipo_ledger_owner_idx" ON "ipo_ledger" USING btree ("owner_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_links_hash_uq" ON "ipo_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ipo_links_partner_idx" ON "ipo_links" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "ipo_partners_owner_idx" ON "ipo_partners" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ipo_rounds_owner_idx" ON "ipo_rounds" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_rounds_issue_uq" ON "ipo_rounds" USING btree ("owner_id","issue_id");--> statement-breakpoint
CREATE INDEX "ipo_snapshots_issue_idx" ON "ipo_snapshots" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "ipo_sources_owner_idx" ON "ipo_sources" USING btree ("owner_id");