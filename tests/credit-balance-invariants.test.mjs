import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function applyMigration(database) {
  const migration = readFileSync(new URL("../drizzle/0095_credit_balance_invariants.sql", import.meta.url), "utf8");
  for (const statement of migration.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) database.exec(statement);
}

test("credit balance and ledger triggers reject invalid direct writes", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, available_credits INTEGER NOT NULL, reserved_credits INTEGER NOT NULL);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT NOT NULL, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE);
    `);
    applyMigration(database);
    database.prepare("INSERT INTO credit_accounts VALUES (?, ?, ?)").run("account-1", 2, 0);
    database.prepare("INSERT INTO credit_ledger_entries VALUES (?, ?, ?, ?, ?)").run("purchase-1", "account-1", "PURCHASE", 1, "purchase-1");
    assert.throws(() => database.prepare("UPDATE credit_accounts SET available_credits = -1 WHERE id = ?").run("account-1"), /CREDIT_BALANCE_NEGATIVE/);
    assert.throws(() => database.prepare("INSERT INTO credit_ledger_entries VALUES (?, ?, ?, ?, ?)").run("bad-reservation", "account-1", "RESERVATION", 1, "bad-reservation"), /CREDIT_LEDGER_AMOUNT_INVALID/);
  } finally {
    database.close();
  }
});
