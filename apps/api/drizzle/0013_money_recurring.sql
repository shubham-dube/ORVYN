CREATE TABLE "money_recurring" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"direction" text DEFAULT 'debit' NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"rrule" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"time" text DEFAULT '09:00' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"mode" text DEFAULT 'add' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_run_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "money_recurring_owner_idx" ON "money_recurring" USING btree ("owner_id");