CREATE TYPE "public"."changelog_status" AS ENUM('draft', 'live');--> statement-breakpoint
CREATE TYPE "public"."changelog_type" AS ENUM('feature', 'fix', 'content', 'note');--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "changelog_type" DEFAULT 'feature' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "changelog_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_entries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "changelog_status_idx" ON "changelog_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "changelog_published_idx" ON "changelog_entries" USING btree ("published_at");