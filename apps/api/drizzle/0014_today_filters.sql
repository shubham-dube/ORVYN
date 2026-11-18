CREATE TABLE "today_filters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"project_id" text,
	"tag" text,
	"min_priority" integer DEFAULT 0 NOT NULL,
	"when" text DEFAULT 'any' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "today_filters_owner_idx" ON "today_filters" USING btree ("owner_id");