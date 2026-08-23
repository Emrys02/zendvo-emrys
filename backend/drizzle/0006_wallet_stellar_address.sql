ALTER TABLE "users" ADD COLUMN "stellar_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stellar_address_unique" UNIQUE("stellar_address");
