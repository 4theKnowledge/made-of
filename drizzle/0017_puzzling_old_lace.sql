CREATE TYPE "public"."reaction_target" AS ENUM('recipe', 'item');--> statement-breakpoint
CREATE TABLE "reactions" (
	"target_kind" "reaction_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" smallint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_target_kind_target_id_user_id_pk" PRIMARY KEY("target_kind","target_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "reactions_user_idx" ON "reactions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_value_check" CHECK ("value" IN (-1, 1));