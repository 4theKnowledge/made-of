CREATE TYPE "public"."confidence" AS ENUM('established', 'strong', 'debated', 'hypothesis');--> statement-breakpoint
CREATE TYPE "public"."evidence_stance" AS ENUM('supports', 'contradicts');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('cosmic', 'element', 'mineral', 'living', 'substance', 'food', 'energy', 'part', 'object', 'tool', 'place', 'information');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('draft', 'review', 'live');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('f', 'w', 'n', 's', 'e');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('paper', 'book', 'review', 'news', 'government', 'university', 'museum', 'industry', 'encyclopedia');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('F', 'N', 'M', 'C', 'P', 'S');--> statement-breakpoint
CREATE TABLE "daily_puzzles" (
	"date" text PRIMARY KEY NOT NULL,
	"start_item_id" text NOT NULL,
	"goal_item_id" text NOT NULL,
	"par" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_sources" (
	"evidence_id" text NOT NULL,
	"source_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "evidence_sources_evidence_id_source_id_pk" PRIMARY KEY("evidence_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" "tier" NOT NULL,
	"kind" "item_kind" NOT NULL,
	"first_appeared" text,
	"first_appeared_ya" integer,
	"symbol" text,
	"fact" text DEFAULT '' NOT NULL,
	"status" "item_status" DEFAULT 'live' NOT NULL,
	"is_canary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "link_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"type" text NOT NULL,
	"stance" "evidence_stance" NOT NULL,
	"summary" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text,
	"item_id" text,
	"type" "link_type" NOT NULL,
	"target_item_id" text NOT NULL,
	"confidence" "confidence" DEFAULT 'established' NOT NULL,
	"note" text,
	"is_canary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"item_id" text,
	"link_id" text,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "source_kind" NOT NULL,
	"title" text NOT NULL,
	"authors" text,
	"year" integer,
	"published" text,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_start_item_id_items_id_fk" FOREIGN KEY ("start_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_goal_item_id_items_id_fk" FOREIGN KEY ("goal_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_evidence_id_link_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."link_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_evidence" ADD CONSTRAINT "link_evidence_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_target_item_id_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_puzzles_pair_idx" ON "daily_puzzles" USING btree ("start_item_id","goal_item_id");--> statement-breakpoint
CREATE INDEX "evidence_sources_source_idx" ON "evidence_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "items_tier_idx" ON "items" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "link_evidence_link_idx" ON "link_evidence" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "links_recipe_idx" ON "links" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "links_item_idx" ON "links" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "links_target_idx" ON "links" USING btree ("target_item_id");--> statement-breakpoint
CREATE INDEX "links_type_idx" ON "links" USING btree ("type");--> statement-breakpoint
CREATE INDEX "progress_user_idx" ON "progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "progress_kind_ref_idx" ON "progress" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "recipes_item_idx" ON "recipes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_item_position_idx" ON "recipes" USING btree ("item_id","position");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_recipe_xor_item" CHECK ((recipe_id IS NULL) <> (item_id IS NULL));