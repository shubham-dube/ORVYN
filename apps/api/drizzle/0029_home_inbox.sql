CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text NOT NULL,
	"account" text NOT NULL,
	"provider" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone,
	"url" text,
	"category" text DEFAULT 'update' NOT NULL,
	"score" integer DEFAULT 30 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"action" text DEFAULT 'none' NOT NULL,
	"amount_minor" bigint,
	"due_date" text,
	"state" text DEFAULT 'new' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"by" text DEFAULT 'rules' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_senders" (
	"owner_id" uuid NOT NULL,
	"email" text NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_senders_owner_id_email_pk" PRIMARY KEY("owner_id","email")
);
--> statement-breakpoint
CREATE TABLE "inbox_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"catch_up" text,
	"catch_up_key" text,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_uq" ON "inbox_items" USING btree ("owner_id","connection_id","external_id");--> statement-breakpoint
CREATE INDEX "inbox_items_owner_idx" ON "inbox_items" USING btree ("owner_id","state");