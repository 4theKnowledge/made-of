-- Combine themes: curated subsets of items playable together. First-class
-- entities so admins can add/rename/validate themes without a schema change,
-- and so the game can run a reachability check per theme.

CREATE TABLE "combine_themes" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "combine_themes_position_idx" ON "combine_themes" USING btree ("position");
--> statement-breakpoint

-- Seed the two themes that already exist in code. 'everything' is the main
-- open-ended mode. 'everyday' is the previously-retired theme we're bringing
-- back as a proper managed set.
INSERT INTO "combine_themes" ("code", "label", "description", "position") VALUES
	('everything', 'Everything', 'The whole map: atoms, stars, life, food, factories, machines.', 0),
	('everyday',   'Everyday',   'Food, home, craft, clothes — the human-scale subset.',               1);
--> statement-breakpoint

CREATE TABLE "item_combine_themes" (
	"item_id" uuid NOT NULL,
	"theme_code" text NOT NULL,
	CONSTRAINT "item_combine_themes_item_id_theme_code_pk" PRIMARY KEY("item_id","theme_code")
);
--> statement-breakpoint

ALTER TABLE "item_combine_themes" ADD CONSTRAINT "item_combine_themes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_combine_themes" ADD CONSTRAINT "item_combine_themes_theme_code_combine_themes_code_fk" FOREIGN KEY ("theme_code") REFERENCES "public"."combine_themes"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "item_combine_themes_theme_idx" ON "item_combine_themes" USING btree ("theme_code");
--> statement-breakpoint

-- Populate 'everything' with every item that isn't tagged 'combine-exclude'.
-- Mirrors isCombineExcluded() in src/combine/filters.ts, which was the
-- existing (tag-driven) source of truth for Everything membership.
INSERT INTO "item_combine_themes" ("item_id", "theme_code")
SELECT "id", 'everything'
FROM "items"
WHERE NOT ('combine-exclude' = ANY("tags"));
--> statement-breakpoint

-- Migrate the legacy 'combine-everyday' tag → 'everyday' theme membership.
-- The tag was retained in src/data/types.ts for legacy data compatibility;
-- this picks up any items that still carry it.
INSERT INTO "item_combine_themes" ("item_id", "theme_code")
SELECT "id", 'everyday'
FROM "items"
WHERE 'combine-everyday' = ANY("tags")
ON CONFLICT ("item_id", "theme_code") DO NOTHING;
