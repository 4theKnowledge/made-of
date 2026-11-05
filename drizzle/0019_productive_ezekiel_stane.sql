CREATE TABLE "combine_daily_config" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"theme_code" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "combine_daily_config" ADD CONSTRAINT "combine_daily_config_theme_code_combine_themes_code_fk" FOREIGN KEY ("theme_code") REFERENCES "public"."combine_themes"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "combine_themes" DROP COLUMN "daily_config";