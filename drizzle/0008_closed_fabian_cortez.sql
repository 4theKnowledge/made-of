CREATE TYPE "public"."code_kind" AS ENUM('invite', 'promo');--> statement-breakpoint
CREATE TABLE "code_redemptions" (
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_redemptions_code_user_id_pk" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
CREATE TABLE "codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" "code_kind" DEFAULT 'invite' NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."codes"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_redemptions_user_idx" ON "code_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "codes_kind_idx" ON "codes" USING btree ("kind");