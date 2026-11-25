CREATE TABLE "replies" (
	"application_id" bigint NOT NULL,
	"decision_maker_id" bigint NOT NULL,
	"gmail_message_id" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "replies_application_id_decision_maker_id_pk" PRIMARY KEY("application_id","decision_maker_id")
);
--> statement-breakpoint
ALTER TABLE "replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_recipient_fk" FOREIGN KEY ("application_id","decision_maker_id") REFERENCES "public"."application_recipients"("application_id","decision_maker_id") ON DELETE cascade ON UPDATE no action;