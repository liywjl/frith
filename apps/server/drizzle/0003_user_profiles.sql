ALTER TABLE "users" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_emoji" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_emoji" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_text" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'paper' NOT NULL;