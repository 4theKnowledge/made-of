CREATE TYPE "public"."combine_scope" AS ENUM('endless', 'daily');--> statement-breakpoint
ALTER TABLE "combine_discoveries" ADD COLUMN "scope" "combine_scope" DEFAULT 'endless' NOT NULL;--> statement-breakpoint
ALTER TABLE "combine_discoveries" DROP CONSTRAINT "combine_discoveries_user_id_item_id_pk";--> statement-breakpoint
ALTER TABLE "combine_discoveries" ADD CONSTRAINT "combine_discoveries_user_id_item_id_scope_pk" PRIMARY KEY("user_id","item_id","scope");--> statement-breakpoint
CREATE INDEX "combine_discoveries_user_scope_idx" ON "combine_discoveries" USING btree ("user_id","scope");
