ALTER TABLE "user" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "handle_locked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "user_handle_lower_idx" ON "user" USING btree (lower("handle"));