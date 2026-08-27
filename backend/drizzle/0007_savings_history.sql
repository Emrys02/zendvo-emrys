CREATE TYPE "public"."savings_status" AS ENUM('inactive', 'active');--> statement-breakpoint
CREATE TYPE "public"."savings_transaction_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."savings_transaction_type" AS ENUM('deposit', 'withdrawal', 'yield_claim');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "savings_status" "savings_status" DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "savings_balance" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vault_contract_id" text;--> statement-breakpoint
CREATE TABLE "savings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vault_contract_id" text NOT NULL,
	"type" "savings_transaction_type" NOT NULL,
	"status" "savings_transaction_status" DEFAULT 'pending' NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"transaction_hash" text,
	"shares_to_burn" double precision,
	"share_price" double precision,
	"shares_balance" double precision,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "savings_history" ADD CONSTRAINT "savings_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sh_user_id_idx" ON "savings_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sh_vault_contract_id_idx" ON "savings_history" USING btree ("vault_contract_id");--> statement-breakpoint
CREATE INDEX "sh_status_idx" ON "savings_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sh_type_idx" ON "savings_history" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sh_transaction_hash_idx" ON "savings_history" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "sh_created_at_idx" ON "savings_history" USING btree ("created_at");
