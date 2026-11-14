-- Credit balances are authoritative derived state. Keep the database itself
-- fail-closed so a future route, repair script, or migration cannot create a
-- negative balance even if it bypasses the application helpers.
CREATE TRIGGER `credit_accounts_nonnegative_insert`
BEFORE INSERT ON `credit_accounts`
WHEN NEW.available_credits < 0 OR NEW.reserved_credits < 0
BEGIN
  SELECT RAISE(ABORT, 'CREDIT_BALANCE_NEGATIVE');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_accounts_nonnegative_update`
BEFORE UPDATE OF `available_credits`, `reserved_credits` ON `credit_accounts`
WHEN NEW.available_credits < 0 OR NEW.reserved_credits < 0
BEGIN
  SELECT RAISE(ABORT, 'CREDIT_BALANCE_NEGATIVE');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_ledger_amount_integrity`
BEFORE INSERT ON `credit_ledger_entries`
WHEN (NEW.entry_type = 'PURCHASE' AND NEW.amount <= 0)
  OR (NEW.entry_type = 'RESERVATION' AND NEW.amount != -1)
  OR (NEW.entry_type = 'RESERVATION_RELEASE' AND NEW.amount != 1)
  OR (NEW.entry_type = 'CONSUMPTION' AND NEW.amount != 0)
  OR (NEW.entry_type = 'REFUND' AND NEW.amount >= 0)
BEGIN
  SELECT RAISE(ABORT, 'CREDIT_LEDGER_AMOUNT_INVALID');
END;
