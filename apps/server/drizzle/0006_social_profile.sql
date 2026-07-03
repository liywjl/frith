ALTER TABLE "users" ADD COLUMN "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "now_playing" text;