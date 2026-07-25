import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  bankAccounts,
  bankAccountsRelations,
  usersRelations,
} from "../../src/lib/db/schema";

describe("bankAccounts schema", () => {
  const config = getTableConfig(bankAccounts);

  it("defines the bank_accounts table and user relationship", () => {
    expect(getTableName(bankAccounts)).toBe("bank_accounts");
    expect(bankAccountsRelations).toBeDefined();
    expect(usersRelations).toBeDefined();

    const userForeignKey = config.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === "bank_accounts_user_id_users_id_fk",
    );

    expect(userForeignKey).toBeDefined();
  });

  it("requires encrypted account-number fields and exposes no plaintext column", () => {
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(columns.account_number).toBeUndefined();
    expect(columns.account_number_ciphertext.notNull).toBe(true);
    expect(columns.account_number_iv.notNull).toBe(true);
    expect(columns.account_number_auth_tag.notNull).toBe(true);
    expect(columns.account_number_key_version.notNull).toBe(true);
    expect(columns.account_number_last_4.notNull).toBe(true);
    expect(columns.account_number_fingerprint.notNull).toBe(true);
  });

  it("supports regional bank identifiers", () => {
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(columns.bank_name.notNull).toBe(true);
    expect(columns.account_name.notNull).toBe(true);
    expect(columns.country.notNull).toBe(true);
    expect(columns.currency.notNull).toBe(true);
    expect(columns.routing_number.notNull).toBe(false);
    expect(columns.sort_code.notNull).toBe(false);
    expect(columns.bank_code.notNull).toBe(false);
    expect(columns.swift_bic.notNull).toBe(false);
  });

  it("prevents duplicate accounts for the same user", () => {
    const constraint = config.uniqueConstraints.find(
      (candidate) =>
        candidate.name === "bank_accounts_user_fingerprint_key",
    );

    expect(constraint?.columns.map((column) => column.name)).toEqual([
      "user_id",
      "account_number_fingerprint",
    ]);
  });

  it("validates display digits and encryption key versions", () => {
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "bank_accounts_last4_check",
        "bank_accounts_key_version_check",
      ]),
    );
  });

  it("fails the migration before legacy plaintext can be relabeled or dropped", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../drizzle/0004_secure_bank_accounts.sql"),
      "utf8",
    );

    const guard = migration.indexOf("bank_accounts contains legacy plaintext");
    const schemaChange = migration.indexOf('ALTER TABLE "bank_accounts"');

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(schemaChange);
    expect(migration).toContain(
      'ADD COLUMN "account_number_ciphertext" text NOT NULL',
    );
    expect(migration).toContain('DROP COLUMN "account_number"');
    expect(migration).not.toContain("RENAME COLUMN");
  });
});
