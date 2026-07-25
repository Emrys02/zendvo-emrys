DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "bank_accounts" LIMIT 1) THEN
		RAISE EXCEPTION 'bank_accounts contains legacy plaintext rows; encrypt or remove them before applying this migration';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "swift_bic" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "bank_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_iv" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_auth_tag" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_last_4" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "routing_number" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "sort_code" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "bank_code" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP COLUMN "account_number";--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_fingerprint_key" UNIQUE("user_id","account_number_fingerprint");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_last4_check" CHECK (char_length("bank_accounts"."account_number_last_4") = 4);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_key_version_check" CHECK ("bank_accounts"."account_number_key_version" > 0);
