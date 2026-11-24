CREATE TABLE "ipo_pool_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ipo_applications" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ipo_rounds" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
-- rounds already past their close are summed up already: no late "closed" pings for old IPOs
UPDATE "ipo_rounds" SET "closed_at" = now() WHERE "issue_id" IN (SELECT "id" FROM "ipo_issues" WHERE "close_date" < to_char(current_date, 'YYYY-MM-DD'));--> statement-breakpoint
UPDATE "ipo_applications" SET "history" = jsonb_build_array(jsonb_build_object('status', "status", 'at', "updated_at", 'by', "reported_by"));
