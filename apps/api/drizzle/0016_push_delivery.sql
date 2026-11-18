ALTER TABLE "push_targets" ADD COLUMN "last_result" text;--> statement-breakpoint
ALTER TABLE "push_targets" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "push_targets" ADD COLUMN "last_at" timestamp with time zone;