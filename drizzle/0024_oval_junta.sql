ALTER TABLE "combine_themes" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "combine_themes" ADD COLUMN "pictogram" text;--> statement-breakpoint
-- Keep the current public theme visible to players. Everything else (incl.
-- everyday, biology, etc.) stays unpublished until the admin promotes.
UPDATE "combine_themes" SET "is_published" = TRUE WHERE "code" = 'everything';