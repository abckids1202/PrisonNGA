export function financeSummaryStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT
      COALESCE((SELECT SUM(cle.amount) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR' WHERE ca.facility_id = ? AND cle.entry_type = 'PURCHASE'), 0) AS credits_purchased,
      COALESCE((SELECT SUM(ABS(cle.amount)) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR' WHERE ca.facility_id = ? AND cle.entry_type = 'CONSUMPTION'), 0) AS credits_consumed,
      COALESCE((SELECT SUM(ca.reserved_credits) FROM credit_accounts ca INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR' WHERE ca.facility_id = ?), 0) AS credits_reserved,
      (SELECT COUNT(*) FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR' WHERE pi.facility_id = ? AND pi.status IN ('REFUNDED', 'DISPUTED')) AS refund_cases,
      (SELECT COUNT(*) FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR' WHERE pi.facility_id = ? AND pi.status IN ('PENDING', 'CHECKOUT_CREATED')) AS pending_payments,
      COALESCE((SELECT SUM(pi.amount_minor) FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR' WHERE pi.facility_id = ? AND pi.status = 'SUCCEEDED'), 0) AS settled_amount_minor,
      (SELECT MAX(created_at) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR' WHERE ca.facility_id = ?) AS last_ledger_activity`)
    .bind(facilityId, facilityId, facilityId, facilityId, facilityId, facilityId, facilityId);
}

export function financeLedgerStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT cle.id, cle.appointment_id, cle.entry_type, cle.amount, cle.reason, cle.created_at,
      u.display_name AS visitor_name
    FROM credit_ledger_entries cle
    INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id AND ca.facility_id = ?
    INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR'
    ORDER BY cle.created_at DESC LIMIT 50`).bind(facilityId);
}

export function financePaymentsStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT pi.id, pi.provider, pi.credit_quantity, pi.amount_minor, pi.currency, pi.status,
      pi.provider_reference, pi.created_at, pi.updated_at, u.display_name AS visitor_name
    FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
    WHERE pi.facility_id = ? ORDER BY pi.created_at DESC LIMIT 50`).bind(facilityId);
}

export function financeReconciliationStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT issue_type, payment_intent_id, provider_event_id, detail
    FROM (
      SELECT 'PAYMENT_WITHOUT_PURCHASE' AS issue_type, pi.id AS payment_intent_id, NULL AS provider_event_id,
        'Succeeded payment has no matching PURCHASE ledger entry.' AS detail
      FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pi.facility_id = ? AND pi.status = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR'
          WHERE ca.facility_id = pi.facility_id AND cle.idempotency_key = 'payment:' || pi.id || ':purchase')
      UNION ALL
      SELECT 'REFUND_WITHOUT_REVERSAL', pi.id, NULL,
        'Refunded payment has no matching REFUND ledger entry.'
      FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pi.facility_id = ? AND pi.status = 'REFUNDED'
        AND EXISTS (SELECT 1 FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR'
          WHERE ca.facility_id = pi.facility_id AND cle.idempotency_key = 'payment:' || pi.id || ':purchase')
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR'
          WHERE ca.facility_id = pi.facility_id AND cle.idempotency_key = 'payment:' || pi.id || ':refund')
      UNION ALL
      SELECT 'RECEIVED_PROVIDER_EVENT', pi.id, ppe.id,
        'Provider event is still RECEIVED and requires retry or investigation.'
      FROM payment_provider_events ppe INNER JOIN payment_intents pi
        ON pi.id = json_extract(ppe.payload, '$.paymentIntentId')
      INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pi.facility_id = ? AND ppe.status IN ('RECEIVED', 'PROCESSING', 'FAILED', 'DEAD_LETTER')
      UNION ALL
      SELECT 'REFUND_REQUEST_PENDING', pr.payment_intent_id, pr.id,
        'Refund request has not received a provider confirmation.'
      FROM payment_refund_requests pr INNER JOIN payment_intents pi ON pi.id = pr.payment_intent_id INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pr.facility_id = ? AND pr.status = 'REQUESTED'
      UNION ALL
      SELECT 'REFUND_REQUEST_FAILED', pr.payment_intent_id, pr.id,
        'Refund request failed before provider acceptance and requires a retry.'
      FROM payment_refund_requests pr INNER JOIN payment_intents pi ON pi.id = pr.payment_intent_id INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pr.facility_id = ? AND pr.status = 'FAILED'
      UNION ALL
      SELECT 'CREDIT_ACCOUNT_BALANCE_MISMATCH', NULL, NULL,
        'Credit account ' || ca.id || ' does not reconcile with its append-only ledger or active reservation count.'
      FROM credit_accounts ca INNER JOIN users u ON u.id = ca.user_id AND u.user_type = 'VISITOR'
      WHERE ca.facility_id = ?
        AND (ca.available_credits < 0 OR ca.reserved_credits < 0
          OR ca.available_credits + ca.reserved_credits <> (SELECT COALESCE(SUM(cle.amount), 0) FROM credit_ledger_entries cle WHERE cle.credit_account_id = ca.id)
          OR ca.reserved_credits <> (SELECT COUNT(*) FROM credit_ledger_entries reservation
            WHERE reservation.credit_account_id = ca.id AND reservation.entry_type = 'RESERVATION'
              AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries terminal WHERE terminal.appointment_id = reservation.appointment_id AND terminal.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))))
    )
    ORDER BY issue_type, payment_intent_id LIMIT 100`).bind(facilityId, facilityId, facilityId, facilityId, facilityId, facilityId);
}
