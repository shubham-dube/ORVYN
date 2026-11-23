CREATE TABLE "chat_hidden" (
	"message_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_hidden_message_id_owner_id_pk" PRIMARY KEY("message_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"message_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reactions_message_id_owner_id_pk" PRIMARY KEY("message_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "pinned_message_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "last_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "v" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "forwarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "files_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "chat_hidden_owner_idx" ON "chat_hidden" USING btree ("owner_id");