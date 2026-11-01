-- Move domain tables from text slugs to uuids.
--
-- There is no production data yet, so this migration is destructive: we
-- truncate the item/link/evidence/source graph (and the daily puzzles /
-- reports that reference them), swap the column types to uuid, add the new
-- items.slug and sources.code columns, and let `npm run db:seed` repopulate.
--
-- Auth tables (user/session/account/verification) are untouched. So are
-- subscriptions and progress — they don't reference items or links.

BEGIN;

-- Clear everything that references the graph, children first.
TRUNCATE TABLE
  "evidence_sources",
  "link_evidence",
  "links",
  "recipes",
  "daily_puzzles",
  "reports",
  "sources",
  "items"
RESTART IDENTITY CASCADE;

-- Drop existing foreign keys so we can change the referenced column types.
ALTER TABLE "evidence_sources" DROP CONSTRAINT IF EXISTS "evidence_sources_evidence_id_link_evidence_id_fk";
ALTER TABLE "evidence_sources" DROP CONSTRAINT IF EXISTS "evidence_sources_source_id_sources_id_fk";
ALTER TABLE "link_evidence" DROP CONSTRAINT IF EXISTS "link_evidence_link_id_links_id_fk";
ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_recipe_id_recipes_id_fk";
ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_item_id_items_id_fk";
ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_target_item_id_items_id_fk";
ALTER TABLE "recipes" DROP CONSTRAINT IF EXISTS "recipes_item_id_items_id_fk";
ALTER TABLE "daily_puzzles" DROP CONSTRAINT IF EXISTS "daily_puzzles_start_item_id_items_id_fk";
ALTER TABLE "daily_puzzles" DROP CONSTRAINT IF EXISTS "daily_puzzles_goal_item_id_items_id_fk";
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_item_id_items_id_fk";
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_link_id_links_id_fk";

-- Switch types to uuid. Columns are empty now, so USING is unnecessary.
ALTER TABLE "items" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
ALTER TABLE "items" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "recipes" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
ALTER TABLE "recipes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "recipes" ALTER COLUMN "item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "links" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
ALTER TABLE "links" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "links" ALTER COLUMN "recipe_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "links" ALTER COLUMN "item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "links" ALTER COLUMN "target_item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "link_evidence" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
ALTER TABLE "link_evidence" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "link_evidence" ALTER COLUMN "link_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "sources" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
ALTER TABLE "sources" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "evidence_sources" ALTER COLUMN "evidence_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "evidence_sources" ALTER COLUMN "source_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "daily_puzzles" ALTER COLUMN "start_item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "daily_puzzles" ALTER COLUMN "goal_item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "reports" ALTER COLUMN "item_id" SET DATA TYPE uuid USING NULL;
ALTER TABLE "reports" ALTER COLUMN "link_id" SET DATA TYPE uuid USING NULL;

-- Add the new slug / code columns.
ALTER TABLE "items" ADD COLUMN "slug" text NOT NULL;
ALTER TABLE "items" ADD CONSTRAINT "items_slug_unique" UNIQUE("slug");
ALTER TABLE "sources" ADD COLUMN "code" text NOT NULL;
ALTER TABLE "sources" ADD CONSTRAINT "sources_code_unique" UNIQUE("code");

-- Re-create the foreign keys.
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_item_id_items_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "links" ADD CONSTRAINT "links_recipe_id_recipes_id_fk"
  FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "links" ADD CONSTRAINT "links_item_id_items_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "links" ADD CONSTRAINT "links_target_item_id_items_id_fk"
  FOREIGN KEY ("target_item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "link_evidence" ADD CONSTRAINT "link_evidence_link_id_links_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_evidence_id_link_evidence_id_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "public"."link_evidence"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_source_id_sources_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_start_item_id_items_id_fk"
  FOREIGN KEY ("start_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_goal_item_id_items_id_fk"
  FOREIGN KEY ("goal_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_item_id_items_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_link_id_links_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;

COMMIT;
