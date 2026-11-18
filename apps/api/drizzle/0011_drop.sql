CREATE TABLE "drop_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"file_name" text,
	"url" text,
	"source" text DEFAULT 'web' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"proposal" jsonb,
	"problem" text,
	"result_ref" text,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "drop_items_owner_idx" ON "drop_items" USING btree ("owner_id","created_at");