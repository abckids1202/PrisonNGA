import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { applySecurityHeaders, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, SecurityError } from "../../../../../lib/server/security";
import { csvCell } from "../../../../../lib/server/csv";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.export");
    const search = new URL(request.url).searchParams;
    const from = search.get("from")?.trim() || null;
    const to = search.get("to")?.trim() || null;
    const limit = Math.min(Math.max(Number(search.get("limit") || "1000"), 1), 5000);
    if (from && Number.isNaN(Date.parse(from))) throw new SecurityError("INVALID_AUDIT_FROM", 400);
    if (to && Number.isNaN(Date.parse(to))) throw new SecurityError("INVALID_AUDIT_TO", 400);
    if (from && to && Date.parse(from) > Date.parse(to)) throw new SecurityError("INVALID_AUDIT_RANGE", 400);
    await requireStepUp({ purpose: "audit_export", userId: authorization.userId, targetId: `${authorization.facilityId}:audit_export`, payload: { from, to, limit } });
    const d1 = await getD1();
    const clauses = ["facility_id = ?"];
    const bindings: (string | number)[] = [authorization.facilityId];
    if (from) { clauses.push("created_at >= ?"); bindings.push(from); }
    if (to) { clauses.push("created_at <= ?"); bindings.push(to); }
    bindings.push(limit);
    const query = `SELECT id, created_at, action_type, entity_type, entity_id, actor_user_id, actor_role, reason, correlation_id, request_id, old_values, new_values FROM audit_events WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC LIMIT ?`;
    const rows = await d1.prepare(query).bind(...bindings).all<Record<string, unknown>>();
    const lines = ["id,created_at,action_type,entity_type,entity_id,actor_user_id,actor_role,reason,correlation_id,request_id,old_values,new_values"];
    for (const row of rows.results) lines.push([row.id, row.created_at, row.action_type, row.entity_type, row.entity_id, row.actor_user_id, row.actor_role, row.reason, row.correlation_id, row.request_id, row.old_values, row.new_values].map(csvCell).join(","));
    const csv = `${lines.join("\n")}\n`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv));
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const exportId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const auditInput = {
      actorUserId: authorization.userId,
      actorRole: authorization.roles[0] || "Auditor",
      facilityId: authorization.facilityId,
      actionType: "AUDIT_EXPORT_CREATED",
      entityType: "audit_export",
      entityId: sha256,
      reason: `Exported ${rows.results.length} audit events.`,
      newValues: { rowCount: rows.results.length, sha256, from, to },
      requestId: context.requestId,
      correlationId,
      eventType: "AUDIT_EXPORT_CREATED",
      payload: { exportId, rowCount: rows.results.length, sha256 },
    } as const;
    // The manifest and its audit/outbox evidence are one integrity boundary.
    // If either side cannot be committed, the export is not acknowledged.
    const guard = { sql: "EXISTS (SELECT 1 FROM audit_export_manifests WHERE id = ? AND facility_id = ? AND sha256 = ?)", values: [exportId, authorization.facilityId, sha256] };
    const results = await d1.batch([
      d1.prepare("INSERT INTO audit_export_manifests (id, facility_id, requested_by, sha256, row_count, from_at, to_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(exportId, authorization.facilityId, authorization.userId, sha256, rows.results.length, from, to, createdAt),
      ...auditAndOutboxStatements(d1, auditInput, guard),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes || !results[2]?.meta.changes) throw new SecurityError("AUDIT_EXPORT_COMMIT_FAILED", 500);
    const response = new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="securevisit-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "x-audit-export-id": exportId, "x-audit-export-sha256": sha256 } });
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
