ALTER TABLE "applications" ADD COLUMN "industry" text;--> statement-breakpoint
UPDATE "applications" SET "industry" = "industry_keywords"->>0 WHERE jsonb_typeof("industry_keywords") = 'array';--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "industry_keywords";
