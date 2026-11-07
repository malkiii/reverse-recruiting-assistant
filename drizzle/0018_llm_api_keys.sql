CREATE TABLE "llm_api_keys" (
	"provider" text PRIMARY KEY NOT NULL,
	"api_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_api_keys" ENABLE ROW LEVEL SECURITY;