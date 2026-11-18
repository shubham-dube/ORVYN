CREATE TABLE "ai_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"key" text NOT NULL,
	"task" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_cache_owner_key_idx" ON "ai_cache" USING btree ("owner_id","key");--> statement-breakpoint
CREATE INDEX "ai_cache_created_idx" ON "ai_cache" USING btree ("created_at");