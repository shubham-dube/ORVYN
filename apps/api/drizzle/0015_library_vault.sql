CREATE TABLE "library_docs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text DEFAULT 'file' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"file_name" text DEFAULT '' NOT NULL,
	"mime" text DEFAULT '' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"problem" text,
	"key_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_on" text,
	"remind" boolean DEFAULT true NOT NULL,
	"money_state" text DEFAULT 'none' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"blob" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vault_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"pass" text NOT NULL,
	"recovery" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vault_keys_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE INDEX "library_docs_owner_idx" ON "library_docs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "library_docs_expiry_idx" ON "library_docs" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "vault_items_owner_idx" ON "vault_items" USING btree ("owner_id");