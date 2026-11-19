CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"admin_id" uuid,
	"pair_key" text,
	"split_group_id" uuid,
	"last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_devices" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"box_public" text NOT NULL,
	"sign_public" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_keys" (
	"message_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"sealed" text NOT NULL,
	CONSTRAINT "chat_keys_message_id_device_id_pk" PRIMARY KEY("message_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "chat_members" (
	"conversation_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "chat_members_conversation_id_owner_id_pk" PRIMARY KEY("conversation_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_device_id" uuid,
	"kind" text DEFAULT 'msg' NOT NULL,
	"ciphertext" text,
	"nonce" text,
	"signature" text,
	"text" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"date" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"receipt_file_id" uuid,
	"paid" jsonb NOT NULL,
	"method" text NOT NULL,
	"among" jsonb NOT NULL,
	"shares" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'trip' NOT NULL,
	"conversation_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"upi" text DEFAULT '' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text DEFAULT 'UPI' NOT NULL,
	"date" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_pair_uq" ON "chat_conversations" USING btree ("pair_key");--> statement-breakpoint
CREATE INDEX "chat_devices_owner_idx" ON "chat_devices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "chat_members_owner_idx" ON "chat_members" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conv_idx" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "split_activity_group_idx" ON "split_activity" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "split_expenses_group_idx" ON "split_expenses" USING btree ("group_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "split_links_hash_uq" ON "split_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "split_members_group_idx" ON "split_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "split_members_user_idx" ON "split_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "split_settlements_group_idx" ON "split_settlements" USING btree ("group_id");