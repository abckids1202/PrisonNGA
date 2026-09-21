import { SecurityError } from "./security";

type CreditReservation = { creditAccountId: string; appointmentId: string };

export async function reserveVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
): Promise<CreditReservation> {
  const existing = await d1.prepare(
    "SELECT credit_account_id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION' LIMIT 1",
  ).bind(input.appointmentId).first<{ credit_account_id: string }>();
  if (existing) return { creditAccountId: existing.credit_account_id, appointmentId: input.appointmentId };

  const now = new Date().toISOString();
  const debit = await d1.prepare(
    "UPDATE credit_accounts SET available_credits = available_credits - 1, reserved_credits = reserved_credits + 1, version = version + 1, updated_at = ? WHERE id = ? AND available_credits >= 1",
  ).bind(now, input.accountId).run();
  if (!debit.meta.changes) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);

  try {
    await d1.prepare(
      `INSERT INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
       VALUES (?, ?, ?, 'RESERVATION', -1, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:reservation`, input.reason, input.actorUserId, now).run();
    return { creditAccountId: input.accountId, appointmentId: input.appointmentId };
  } catch (error) {
    // Never leave the account debited if the append-only reservation cannot be recorded.
    await releaseVisitCredit(d1, { accountId: input.accountId, appointmentId: input.appointmentId, actorUserId: input.actorUserId, reason: "Reservation ledger write failed." });
    const raced = await d1.prepare(
      "SELECT credit_account_id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION' LIMIT 1",
    ).bind(input.appointmentId).first<{ credit_account_id: string }>();
    if (raced) return { creditAccountId: raced.credit_account_id, appointmentId: input.appointmentId };
    const rollbackNow = new Date().toISOString();
    await d1.prepare(
      "UPDATE credit_accounts SET available_credits = available_credits + 1, reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ? WHERE id = ? AND reserved_credits >= 1",
    ).bind(rollbackNow, input.accountId).run();
    await d1.prepare(
      `INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
       VALUES (?, ?, ?, 'MANUAL_ADJUSTMENT', 1, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:reservation-rollback`, "Reservation ledger rollback.", input.actorUserId, rollbackNow).run();
    throw error;
  }
}

export async function releaseVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
) {
  const reservation = await d1.prepare(
    "SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION' LIMIT 1",
  ).bind(input.appointmentId).first<{ id: string }>();
  if (!reservation) return { released: false };
  const alreadyReleased = await d1.prepare(
    "SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION_RELEASE' LIMIT 1",
  ).bind(input.appointmentId).first<{ id: string }>();
  if (alreadyReleased) return { released: false, idempotent: true };

  const now = new Date().toISOString();
  const account = await d1.prepare(
    "UPDATE credit_accounts SET available_credits = available_credits + 1, reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ? WHERE id = ? AND reserved_credits >= 1",
  ).bind(now, input.accountId).run();
  if (!account.meta.changes) throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
  await d1.prepare(
    `INSERT INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
     VALUES (?, ?, ?, 'RESERVATION_RELEASE', 1, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:reservation-release`, input.reason, input.actorUserId, now).run();
  return { released: true };
}

export async function consumeVisitCredit(
  d1: D1Database,
  input: { accountId: string; appointmentId: string; actorUserId: string; reason: string },
) {
  const existing = await d1.prepare(
    "SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'CONSUMPTION' LIMIT 1",
  ).bind(input.appointmentId).first<{ id: string }>();
  if (existing) return { consumed: false, idempotent: true };
  const now = new Date().toISOString();
  const account = await d1.prepare(
    "UPDATE credit_accounts SET reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ? WHERE id = ? AND reserved_credits >= 1",
  ).bind(now, input.accountId).run();
  if (!account.meta.changes) throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
  await d1.prepare(
    `INSERT INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
     VALUES (?, ?, ?, 'CONSUMPTION', 0, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.accountId, input.appointmentId, `${input.appointmentId}:consumption`, input.reason, input.actorUserId, now).run();
  return { consumed: true };
}
