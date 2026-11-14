const tenantScopedFacilityTables = [
  "visit_policies", "visit_policy_history", "appointment_types", "appointments", "prisoners",
  "visitor_relationships", "verification_cases", "evidence_documents", "retention_policies",
  "legal_holds", "facility_closures", "break_glass_requests", "appointment_status_events",
  "resource_reservations", "resources", "kiosk_credentials", "waiting_room_sessions",
  "visitor_waiting_room_checkins", "visit_sessions", "visitor_device_check_attempts",
  "kiosk_device_check_attempts", "visit_session_events", "visit_session_participants",
  "recording_consents", "recordings", "recording_access_events", "credit_accounts",
  "payment_intents", "payment_refund_requests", "notifications", "incidents",
  "evidence_scan_events", "audit_events", "outbox_events", "security_events",
  "audit_export_manifests", "staff_profiles", "staff_facility_assignments", "user_roles",
] as const;

export type TenantIntegrityIssue = {
  table: string;
  facilityId: string;
  organizationId: string | null;
  mismatchCount: number;
};

const inheritedTenantQueries = [
  {
    table: "credit_ledger_entries",
    sql: `
      SELECT ca.facility_id, ca.organization_id, COUNT(cle.rowid) AS mismatch_count
      FROM credit_accounts ca
      INNER JOIN credit_ledger_entries cle ON cle.credit_account_id = ca.id
      WHERE cle.organization_id IS NULL OR cle.organization_id <> ca.organization_id
      GROUP BY ca.facility_id, ca.organization_id
      HAVING mismatch_count > 0
      LIMIT 25
    `,
  },
  {
    table: "incident_events",
    sql: `
      SELECT i.facility_id, i.organization_id, COUNT(ie.rowid) AS mismatch_count
      FROM incidents i
      INNER JOIN incident_events ie ON ie.incident_id = i.id
      WHERE ie.organization_id IS NULL OR ie.organization_id <> i.organization_id
      GROUP BY i.facility_id, i.organization_id
      HAVING mismatch_count > 0
      LIMIT 25
    `,
  },
] as const;

/** Read-only bounded preflight for denormalized tenant scope. */
export async function checkTenantIntegrity(database: D1Database): Promise<{ ok: boolean; issues: TenantIntegrityIssue[] }> {
  const results = await database.batch([
    ...tenantScopedFacilityTables.map((table) => database.prepare(`
    SELECT f.id AS facility_id, f.organization_id, COUNT(t.rowid) AS mismatch_count
    FROM facilities f
    INNER JOIN ${table} t ON t.facility_id = f.id
    WHERE t.organization_id IS NULL OR t.organization_id <> f.organization_id
    GROUP BY f.id, f.organization_id
    HAVING mismatch_count > 0
    LIMIT 25
  `)),
    ...inheritedTenantQueries.map((query) => database.prepare(query.sql)),
  ]);
  const issues: TenantIntegrityIssue[] = [];
  results.forEach((result, index) => {
    for (const row of (result.results as Array<{ facility_id: string; organization_id: string | null; mismatch_count: number }>)) {
      const table = index < tenantScopedFacilityTables.length
        ? tenantScopedFacilityTables[index]
        : inheritedTenantQueries[index - tenantScopedFacilityTables.length].table;
      issues.push({ table, facilityId: row.facility_id, organizationId: row.organization_id, mismatchCount: Number(row.mismatch_count) });
      if (issues.length >= 25) return;
    }
  });
  return { ok: issues.length === 0, issues };
}
