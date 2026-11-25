ALTER TABLE "application_recipients" ADD COLUMN "gmail_message_id" text;--> statement-breakpoint
ALTER TABLE "application_recipients" ADD COLUMN "gmail_thread_id" text;--> statement-breakpoint
ALTER TABLE "google_connection" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;