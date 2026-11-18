CREATE TABLE "money_merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"merchant" text NOT NULL,
	"action" text NOT NULL,
	"category_id" uuid,
	"hits" integer DEFAULT 1 NOT NULL,
	"always" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "money_rules_owner_merchant_uq" ON "money_merchant_rules" USING btree ("owner_id","merchant_key");