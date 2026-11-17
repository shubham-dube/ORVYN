CREATE TABLE "today_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"patterns" jsonb NOT NULL,
	"day_overrides" jsonb NOT NULL,
	"buffer_min" integer NOT NULL,
	"no_plan_after" text NOT NULL,
	"time_zone" text NOT NULL,
	"reminders" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "today_settings_owner_id_unique" UNIQUE("owner_id")
);
