CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"data" jsonb,
	"hlc" text NOT NULL,
	"device_id" uuid,
	"mutation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_meta" (
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"field_hlcs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_hlc" text,
	"last_seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_meta_entity_entity_id_pk" PRIMARY KEY("entity","entity_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"module" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"dedupe_key" text,
	"source_device_id" uuid,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notify_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"quiet_hours" jsonb,
	"email_for" text[] DEFAULT '{urgent}'::text[] NOT NULL,
	"muted_modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"keys" jsonb,
	"failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify_settings" ADD CONSTRAINT "notify_settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_targets" ADD CONSTRAINT "push_targets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_targets" ADD CONSTRAINT "push_targets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_owner_seq_idx" ON "change_log" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "change_log_mutation_uq" ON "change_log" USING btree ("mutation_id");--> statement-breakpoint
CREATE INDEX "sync_meta_owner_idx" ON "sync_meta" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "notifications_owner_idx" ON "notifications" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("owner_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "push_targets_address_uq" ON "push_targets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "push_targets_owner_idx" ON "push_targets" USING btree ("owner_id");