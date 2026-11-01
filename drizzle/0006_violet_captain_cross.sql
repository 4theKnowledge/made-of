CREATE TABLE "combine_discoveries" (
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"first_found_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combine_discoveries_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "combine_discoveries" ADD CONSTRAINT "combine_discoveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combine_discoveries" ADD CONSTRAINT "combine_discoveries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "combine_discoveries_user_idx" ON "combine_discoveries" USING btree ("user_id");