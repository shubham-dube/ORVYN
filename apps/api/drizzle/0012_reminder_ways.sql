CREATE TABLE "contact_channels" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"whatsapp" text,
	"whatsapp_verified_at" timestamp with time zone,
	"verify_hash" text,
	"verify_expires_at" timestamp with time zone,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "alarm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "via" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "repeat_every_min" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "repeat_left" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;