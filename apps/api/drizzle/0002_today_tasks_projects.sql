CREATE TABLE "today_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" text DEFAULT 'sky' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "today_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"due_date" text,
	"due_at" timestamp with time zone,
	"scheduled_start" timestamp with time zone,
	"duration_min" integer,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"rrule" text,
	"reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"source" text DEFAULT 'typed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "today_projects_owner_idx" ON "today_projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "today_tasks_owner_idx" ON "today_tasks" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "today_tasks_owner_due_idx" ON "today_tasks" USING btree ("owner_id","due_at");--> statement-breakpoint
CREATE INDEX "today_tasks_owner_sched_idx" ON "today_tasks" USING btree ("owner_id","scheduled_start");