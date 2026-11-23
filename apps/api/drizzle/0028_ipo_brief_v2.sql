CREATE TABLE "ipo_decisions" (
	"owner_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_decisions_owner_id_issue_id_pk" PRIMARY KEY("owner_id","issue_id")
);
--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "min_investment" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "face_value" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "listing_on" text;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "sale_type" text;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "listing_gain_pct" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "cmp" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "kostak" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "sauda" double precision;--> statement-breakpoint
ALTER TABLE "ipo_issues" ADD COLUMN "details" jsonb;