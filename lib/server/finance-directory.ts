export function financeSummaryStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT
      COALESCE((SELECT SUM(cle.amount) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id WHERE ca.facility_id = ? AND cle.entry_type = 'PURCHASE'), 0) AS credits_purchased,
      COALESCE((SELECT SUM(ABS(cle.amount)) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id WHERE ca.facility_id = ? AND cle.entry_type = 'CONSUMPTION'), 0) AS credits_consumed,
      COALESCE((SELECT SUM(ca.reserved_credits) FROM credit_accounts ca WHERE ca.facility_id = ?), 0) AS credits_reserved,
      (SELECT COUNT(*) FROM payment_intents pi WHERE pi.facility_id = ? AND pi.status IN ('REFUNDED', 'DISPUTED')) AS refund_cases,
      (SELECT COUNT(*) FROM payment_intents pi WHERE pi.facility_id = ? AND pi.status IN ('PENDING', 'CHECKOUT_CREATED')) AS pending_payments,
      COALESCE((SELECT SUM(pi.amount_minor) FROM payment_intents pi WHERE pi.facility_id = ? AND pi.status = 'SUCCEEDED'), 0) AS settled_amount_minor,
      (SELECT MAX(created_at) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id WHERE ca.facility_id = ?) AS last_ledger_activity`)
    .bind(facilityId, facilityId, facilityId, facilityId, facilityId, facilityId, facilityId);
}

export function financeLedgerStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT cle.id, cle.appointment_id, cle.entry_type, cle.amount, cle.reason, cle.created_at,
      u.display_name AS visitor_name
    FROM credit_ledger_entries cle
    INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id AND ca.facility_id = ?
    INNER JOIN users u ON u.id = ca.user_id
    ORDER BY cle.created_at DESC LIMIT 50`).bind(facilityId);
}

export function financePaymentsStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT pi.id, pi.provider, pi.credit_quantity, pi.amount_minor, pi.currency, pi.status,
      pi.provider_reference, pi.created_at, pi.updated_at, u.display_name AS visitor_name
    FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id
    WHERE pi.facility_id = ? ORDER BY pi.created_at DESC LIMIT 50`).bind(facilityId);
}
