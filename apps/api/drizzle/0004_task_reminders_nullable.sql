ALTER TABLE "today_tasks" ALTER COLUMN "reminders" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "today_tasks" ALTER COLUMN "reminders" DROP NOT NULL;--> statement-breakpoint
-- tasks saved before D17 had [] meaning "defaults"; [] now means "no reminder"
UPDATE "today_tasks" SET "reminders" = NULL WHERE "reminders" = '[]'::jsonb;
