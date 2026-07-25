ALTER TYPE "public"."user_status" ADD VALUE IF NOT EXISTS 'deleted';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"action" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "used_action_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD COLUMN IF NOT EXISTS "action" text;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'action_tokens_token_unique'
	) THEN
		ALTER TABLE "action_tokens"
			ADD CONSTRAINT "action_tokens_token_unique" UNIQUE("token");
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'action_tokens_user_id_users_id_fk'
	) THEN
		ALTER TABLE "action_tokens"
			ADD CONSTRAINT "action_tokens_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "at_user_id_idx" ON "action_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "at_token_idx" ON "action_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "at_expires_at_idx" ON "action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uat_expires_at_idx" ON "used_action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ev_user_action_idx" ON "email_verifications" USING btree ("user_id","action");
