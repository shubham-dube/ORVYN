CREATE TABLE "money_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"last4" text,
	"institution" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "money_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"from_month" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "money_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"icon" text DEFAULT 'circle' NOT NULL,
	"colour" text DEFAULT 'sky' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "money_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"direction" text DEFAULT 'debit' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"raw_merchant" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"dedupe_key" text,
	"ref_no" text,
	"transfer" boolean DEFAULT false NOT NULL,
	"reviewed" boolean DEFAULT true NOT NULL,
	"receipt_file_id" uuid,
	"drop_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "money_accounts_owner_idx" ON "money_accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "money_budgets_owner_idx" ON "money_budgets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "money_categories_owner_idx" ON "money_categories" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "money_tx_owner_time_idx" ON "money_transactions" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "money_tx_owner_dedupe_uq" ON "money_transactions" USING btree ("owner_id","dedupe_key") WHERE "money_transactions"."dedupe_key" is not null and "money_transactions"."deleted_at" is null;