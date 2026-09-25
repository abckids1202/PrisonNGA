type OutboxRecipientRow = {
  aggregate_type: string;
  aggregate_id: string | null;
  facility_id: string | null;
};

/**
 * Resolves the visitor recipient from the authoritative aggregate when an
 * event producer did not include visitorUserId in its payload. Every lookup
 * is facility-scoped so a malformed or replayed event cannot cross tenants.
 */
export async function resolveOutboxVisitorRecipient(
  db: Pick<D1Database, "prepare">,
  row: OutboxRecipientRow,
): Promise<string | null> {
  if (!row.aggregate_id) return null;

  // Account-security events are intentionally not facility-scoped. Resolve
  // the aggregate only after confirming it is an active visitor account so a
  // malformed event cannot turn a staff or disabled account into a recipient.
  if (row.aggregate_type === "visitor_account") {
    const visitor = await db.prepare(
      "SELECT id FROM users WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'",
    ).bind(row.aggregate_id).first<{ id: string }>();
    return visitor?.id || null;
  }

  if (!row.facility_id) return null;

  if (row.aggregate_type === "appointment") {
    const appointment = await db.prepare(
      "SELECT visitor_user_id FROM appointments WHERE id = ? AND facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return appointment?.visitor_user_id || null;
  }

  if (row.aggregate_type === "visit_session") {
    const session = await db.prepare(
      "SELECT a.visitor_user_id FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id WHERE vs.id = ? AND vs.facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return session?.visitor_user_id || null;
  }

  if (row.aggregate_type === "visitor_relationship") {
    const relationship = await db.prepare(
      "SELECT visitor_user_id FROM visitor_relationships WHERE id = ? AND facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return relationship?.visitor_user_id || null;
  }

  if (row.aggregate_type === "verification_case") {
    const verification = await db.prepare(
      "SELECT vr.visitor_user_id FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id AND vr.facility_id = vc.facility_id WHERE vc.id = ? AND vc.facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return verification?.visitor_user_id || null;
  }

  if (row.aggregate_type === "evidence_document") {
    const evidence = await db.prepare(
      "SELECT ed.visitor_user_id FROM evidence_documents ed WHERE ed.id = ? AND ed.facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return evidence?.visitor_user_id || null;
  }

  if (row.aggregate_type === "payment_intent") {
    const payment = await db.prepare(
      "SELECT user_id AS visitor_user_id FROM payment_intents WHERE id = ? AND facility_id = ?",
    ).bind(row.aggregate_id, row.facility_id).first<{ visitor_user_id: string }>();
    return payment?.visitor_user_id || null;
  }

  return null;
}
