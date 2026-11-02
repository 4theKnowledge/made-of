CREATE TABLE "combine_season" (
	"theme" text PRIMARY KEY NOT NULL,
	"num_ages" integer DEFAULT 0 NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL
);
