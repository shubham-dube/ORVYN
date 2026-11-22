ALTER TABLE "today_tasks" ADD COLUMN "deadline" text;--> statement-breakpoint
ALTER TABLE "today_tasks" ADD COLUMN "status" text DEFAULT 'todo' NOT NULL;