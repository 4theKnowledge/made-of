CREATE TABLE "combine_dailies" (
	"theme_code" text NOT NULL,
	"day" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combine_dailies_theme_code_day_pk" PRIMARY KEY("theme_code","day")
);
--> statement-breakpoint
ALTER TABLE "combine_dailies" ADD CONSTRAINT "combine_dailies_theme_code_combine_themes_code_fk" FOREIGN KEY ("theme_code") REFERENCES "public"."combine_themes"("code") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "combine_dailies_day_idx" ON "combine_dailies" USING btree ("day");