CREATE TABLE "today_calendars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'orvyn' NOT NULL,
	"account_id" uuid,
	"external_id" text,
	"colour" text DEFAULT 'sky' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"writable" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "today_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"start_date" text,
	"end_date" text,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"rrule" text,
	"exdates" text[] DEFAULT '{}'::text[] NOT NULL,
	"recurring_event_id" uuid,
	"original_start" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"calendar_id" uuid,
	"external_id" text,
	"etag" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "today_calendars_owner_idx" ON "today_calendars" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "today_events_owner_start_idx" ON "today_events" USING btree ("owner_id","start_at");--> statement-breakpoint
CREATE INDEX "today_events_owner_cal_idx" ON "today_events" USING btree ("owner_id","calendar_id");--> statement-breakpoint
CREATE INDEX "today_events_cal_ext_idx" ON "today_events" USING btree ("calendar_id","external_id");