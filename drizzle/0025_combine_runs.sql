CREATE TYPE "public"."combine_run_owner_kind" AS ENUM('user', 'anon');--> statement-breakpoint
CREATE TYPE "public"."combine_run_status" AS ENUM('active', 'ended', 'invalidated');--> statement-breakpoint
CREATE TABLE "combine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_kind" "combine_run_owner_kind" NOT NULL,
	"owner_id" text NOT NULL,
	"mode" text NOT NULL,
	"theme" text NOT NULL,
	"daily_key" text DEFAULT '' NOT NULL,
	"seed" integer NOT NULL,
	"state_json" jsonb NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"status" "combine_run_status" DEFAULT 'active' NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "combine_runs_owner_idx" ON "combine_runs" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "combine_runs_active_unique_idx" ON "combine_runs" USING btree ("owner_kind","owner_id","mode","daily_key") WHERE status = 'active';