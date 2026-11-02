-- Move items.kind from a Postgres enum to a text FK into a new kinds table
-- so admins can add/rename kinds without a schema migration.
--
-- Order matters: we must seed the kinds table with the existing enum values
-- before adding the FK, otherwise every existing items.kind value would be
-- an unresolved reference.

CREATE TABLE "kinds" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "kinds_position_idx" ON "kinds" USING btree ("position");
--> statement-breakpoint

-- Seed with the 12 kinds previously defined in the item_kind enum.
-- Labels and descriptions mirror src/lib/taxonomy.ts.
INSERT INTO "kinds" ("code", "label", "description", "position") VALUES
	('cosmic',      'Cosmic',      NULL, 0),
	('element',     'Element',     NULL, 1),
	('mineral',     'Mineral',     NULL, 2),
	('living',      'Living',      NULL, 3),
	('substance',   'Substance',   NULL, 4),
	('food',        'Food',        NULL, 5),
	('energy',      'Energy',      NULL, 6),
	('part',        'Part',        NULL, 7),
	('object',      'Object',      NULL, 8),
	('tool',        'Tool',        NULL, 9),
	('place',       'Place',       NULL, 10),
	('information', 'Information', NULL, 11);
--> statement-breakpoint

-- Convert items.kind from the item_kind enum to text. Enum values become
-- text verbatim, so existing rows keep their value ('substance' stays
-- 'substance'). USING is explicit to be safe across Postgres versions.
ALTER TABLE "items" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;
--> statement-breakpoint

ALTER TABLE "items" ADD CONSTRAINT "items_kind_kinds_code_fk" FOREIGN KEY ("kind") REFERENCES "public"."kinds"("code") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint

-- Enum type is now unreferenced, drop it.
DROP TYPE "public"."item_kind";
