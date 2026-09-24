import { SecurityError } from "./security";

type CreditReservation = { creditAccountId: string; appointmentId: string; created: boolean };
type CreditSettlementGuard = { sql: string; values: unknown[] };

export async function ensureCreditAccount(d1: D1Database, input: { facilityId: string; userId: string }): Promise<string> {
  const now = new Date().toISOString();
  await d1.prepare("INSERT OR IGNORE INTO credit_accounts (id, facility_id, user_id, available_credits, reserved_credits, version, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 1, ?, ?)")
    .bind(crypto.randomUUID(), input.facilityId, input.userId, now, now).run();
  const account = await d1.prepare("SELECT id FROM credit_accounts WHERE user_id = ? AND facility_id = ?").bind(input.userId, input.facilityId).first<{ id: string }>();
  if (!account) throw new SecurityError("CREDIT_ACCOUNT_NOT_FOUND", 500);
  return account.id;
}

export function settlePaymentPurchaseStatements(
  d1: D1Database,
  input: { paymentIntentId: string; facilityId: string; userId: string; accountId: string; amount: number; reason: string; now: string; requireSucceeded?: boolean },
): D1PreparedStatement[] {
  const purchaseKey = `payment:${input.paymentIntentId}:purchase`;
  const intentStatusGuard = input.requireSucceeded ? "pi.status = 'SUCCEEDED'" : "pi.status NOT IN ('REFUNDED', 'DISPUTED')";
  return [
    d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
      SELECT ?, ?, NULL, 'PURCHASE', ?, ?, ?, 'system:payment-webhook', ?
      WHERE EXISTS (SELECT 1 FROM payment_intents pi WHERE pi.id = ? AND pi.facility_id = ? AND pi.user_id = ? AND ${intentStatusGuard})`)
      .bind(crypto.randomUUID(), input.accountId, input.amount, purchaseKey, input.reason, input.now, input.paymentIntentId, input.facilityId, input.userId),
    d1.prepare("UPDATE credit_accounts SET available_credits = available_credits + ?, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
      .bind(input.amount, input.now, input.accountId),
  ];
}

export async function settlePaymentPurchase(
  d1: D1Database,
  input: { paymentIntentId: string; facilityId: string; userId: string; amount: number; reason: string; requirePayableIntent?: boolean },
) {
  const now = new Date().toISOString();
  const accountId = await ensureCreditAccount(d1, { facilityId: input.facilityId, userId: input.userId });
  const purchaseKey = `payment:${input.paymentIntentId}:purchase`;
  const results = await d1.batch(input.requirePayableIntent
    ? settlePaymentPurchaseStatements(d1, { paymentIntentId: input.paymentIntentId, facilityId: input.facilityId, userId: input.userId, accountId, amount: input.amount, reason: input.reason, now })
    : [
      d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at) VALUES (?, ?, NULL, 'PURCHASE', ?, ?, ?, 'system:payment-webhook', ?)`)
        .bind(crypto.randomUUID(), accountId, input.amount, purchaseKey, input.reason, now),
      d1.prepare("UPDATE credit_accounts SET available_credits = available_credits + ?, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
        .bind(input.amount, now, accountId),
    ]);
  if (!results[0]?.meta.changes) {
    const existingPurchase = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE idempotency_key = ? AND entry_type = 'PURCHASE'")
      .bind(purchaseKey).first<{ id: string }>();
    if (existingPurchase) return { purchased: false, idempotent: true };
    if (input.requirePayableIntent) {
      const intent = await d1.prepare("SELECT status FROM payment_intents WHERE id = ? AND facility_id = ? AND user_id = ?")
        .bind(input.paymentIntentId, input.facilityId, input.userId).first<{ status: string }>();
      if (!intent) throw new SecurityError("PAYMENT_INTENT_NOT_FOUND", 409);
      if (intent.status === "REFUNDED" || intent.status === "DISPUTED") return { purchased: false, idempotent: false, terminal: true };
      throw new SecurityError("PAYMENT_PURCHASE_NOT_SETTLED", 503);
    }
    return { purchased: false, idempotent: true };
  }
  return { purchased: true, idempotent: false };
}

export async function reserveVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
): Promise<CreditReservation> {
  const now = new Date().toISOString();
  const results = await d1.batch([
    d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
      SELECT ?, ?, ?, 'RESERVATION', -1, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM credit_accounts WHERE id = ? AND available_credits >= 1)
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION')`)
      .bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:reservation`, input.reason, input.actorUserId, now, input.accountId, input.appointmentId),
    d1.prepare("UPDATE credit_accounts SET available_credits = available_credits - 1, reserved_credits = reserved_credits + 1, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
      .bind(now, input.accountId),
  ]);
  if (results[0]?.meta.changes) return { creditAccountId: input.accountId, appointmentId: input.appointmentId, created: true };

  const existing = await d1.prepare("SELECT credit_account_id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION' LIMIT 1")
    .bind(input.appointmentId).first<{ credit_account_id: string }>();
  if (existing) {
    if (existing.credit_account_id !== input.accountId) throw new SecurityError("CREDIT_RESERVATION_ACCOUNT_MISMATCH", 409);
    return { creditAccountId: existing.credit_account_id, appointmentId: input.appointmentId, created: false };
  }
  throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
}

export async function releaseVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
) {
  const now = new Date().toISOString();
  const results = await d1.batch(releaseVisitCreditStatements(d1, { ...input, now }));
  if (results[0]?.meta.changes) return { released: true };

  const existing = await d1.prepare("SELECT entry_type FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type IN ('RESERVATION', 'RESERVATION_RELEASE', 'CONSUMPTION') ORDER BY CASE entry_type WHEN 'CONSUMPTION' THEN 0 WHEN 'RESERVATION_RELEASE' THEN 1 ELSE 2 END LIMIT 1")
    .bind(input.appointmentId).first<{ entry_type: string }>();
  if (!existing || existing.entry_type === "CONSUMPTION") return { released: false };
  if (existing.entry_type === "RESERVATION_RELEASE") return { released: false, idempotent: true };
  throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
}

export async function consumeVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
) {
  const now = new Date().toISOString();
  const results = await d1.batch(consumeVisitCreditStatements(d1, { ...input, now }));
  if (results[0]?.meta.changes) return { consumed: true };

  const existing = await d1.prepare("SELECT entry_type FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type IN ('RESERVATION', 'RESERVATION_RELEASE', 'CONSUMPTION') ORDER BY CASE entry_type WHEN 'CONSUMPTION' THEN 0 WHEN 'RESERVATION_RELEASE' THEN 1 ELSE 2 END LIMIT 1")
    .bind(input.appointmentId).first<{ entry_type: string }>();
  if (existing?.entry_type === "CONSUMPTION") return { consumed: false, idempotent: true };
  throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
}

export function releaseVisitCreditStatements(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string; now: string; guard?: CreditSettlementGuard },
): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
      SELECT ?, ?, ?, 'RESERVATION_RELEASE', 1, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM credit_accounts WHERE id = ? AND reserved_credits >= 1)
        AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = 'RESERVATION')
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))
        AND (${input.guard?.sql || "1 = 1"})`)
      .bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:reservation-release`, input.reason, input.actorUserId, input.now,
        input.accountId, input.appointmentId, input.accountId, input.appointmentId, ...(input.guard?.values || [])),
    d1.prepare("UPDATE credit_accounts SET available_credits = available_credits + 1, reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
      .bind(input.now, input.accountId),
  ];
}

export function consumeVisitCreditStatements(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string; now: string; guard?: CreditSettlementGuard },
): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
      SELECT ?, ?, ?, 'CONSUMPTION', 0, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM credit_accounts WHERE id = ? AND reserved_credits >= 1)
        AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = 'RESERVATION')
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))
        AND (${input.guard?.sql || "1 = 1"})`)
      .bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:consumption`, input.reason, input.actorUserId, input.now,
        input.accountId, input.appointmentId, input.accountId, input.appointmentId, ...(input.guard?.values || [])),
    d1.prepare("UPDATE credit_accounts SET reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
      .bind(input.now, input.accountId),
  ];
}

export async function refundPurchasedCredits(
  d1: D1Database,
  input: { paymentIntentId: string; actorUserId: string; reason: string },
) {
  const refundKey = `payment:${input.paymentIntentId}:refund`;
  const existing = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE idempotency_key = ?").bind(`payment:${input.paymentIntentId}:refund`).first<{ id: string }>();
  if (existing) return { refunded: false, idempotent: true };
  const purchase = await d1.prepare(`SELECT cle.credit_account_id, cle.amount FROM credit_ledger_entries cle WHERE cle.idempotency_key = ? AND cle.entry_type = 'PURCHASE' LIMIT 1`).bind(`payment:${input.paymentIntentId}:purchase`).first<{ credit_account_id: string; amount: number }>();
  if (!purchase) return { refunded: false, pending: true };
  const results = await d1.batch(refundPurchasedCreditsStatements(d1, { paymentIntentId: input.paymentIntentId, accountId: purchase.credit_account_id, amount: purchase.amount, actorUserId: input.actorUserId, reason: input.reason, now: new Date().toISOString() }));
  if (results[0]?.meta.changes) return { refunded: true };
  const raced = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE idempotency_key = ?").bind(refundKey).first();
  if (raced) return { refunded: false, idempotent: true };
  throw new SecurityError("CREDIT_REVERSAL_REQUIRES_REVIEW", 409);
}

export function refundPurchasedCreditsStatements(
  d1: D1Database,
  input: { paymentIntentId: string; accountId: string; amount: number; actorUserId: string; reason: string; now: string },
): D1PreparedStatement[] {
  const refundKey = `payment:${input.paymentIntentId}:refund`;
  return [
    d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
      SELECT ?, ?, NULL, 'REFUND', ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM credit_accounts WHERE id = ? AND available_credits >= ?
      )`).bind(crypto.randomUUID(), input.accountId, -input.amount, refundKey, input.reason, input.actorUserId, input.now, input.accountId, input.amount),
    d1.prepare("UPDATE credit_accounts SET available_credits = available_credits - ?, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1")
      .bind(input.amount, input.now, input.accountId),
  ];
}
