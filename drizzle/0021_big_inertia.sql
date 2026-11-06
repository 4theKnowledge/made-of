ALTER TABLE "items" ADD COLUMN "is_combine_excluded" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "items" SET "is_combine_excluded" = true WHERE 'combine-exclude' = ANY("tags");
--> statement-breakpoint
UPDATE "items" SET "tags" = array_remove("tags", 'combine-exclude');
