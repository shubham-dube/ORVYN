CREATE TABLE "money_ious" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"person" text NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"due_date" text,
	"sure" boolean DEFAULT true NOT NULL,
	"settled_at" timestamp with time zone,
	"task_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "money_accounts" ADD COLUMN "balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "money_accounts" ADD COLUMN "balance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_accounts" ADD COLUMN "credit_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD COLUMN "counted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD COLUMN "to_account_id" uuid;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD COLUMN "iou_id" uuid;--> statement-breakpoint
CREATE INDEX "money_ious_owner_idx" ON "money_ious" USING btree ("owner_id");