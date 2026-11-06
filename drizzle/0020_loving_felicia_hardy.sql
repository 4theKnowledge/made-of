CREATE TYPE "public"."site_banner_audience" AS ENUM('everyone', 'signed_in', 'signed_out', 'admins_only');--> statement-breakpoint
CREATE TYPE "public"."site_banner_severity" AS ENUM('info', 'warn', 'critical');--> statement-breakpoint
CREATE TYPE "public"."site_banner_status" AS ENUM('draft', 'live', 'archived');--> statement-breakpoint
CREATE TABLE "site_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"severity" "site_banner_severity" DEFAULT 'info' NOT NULL,
	"status" "site_banner_status" DEFAULT 'draft' NOT NULL,
	"audience" "site_banner_audience" DEFAULT 'everyone' NOT NULL,
	"dismissible" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "site_banners_status_idx" ON "site_banners" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_banners_one_live_idx" ON "site_banners" USING btree ("status") WHERE "site_banners"."status" = 'live';