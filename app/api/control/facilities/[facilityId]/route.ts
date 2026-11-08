import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

const timezonePattern = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/;

export async function PATCH(request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const { facilityId } = await params;
    const authorization = await requirePermission("organization.manage", facilityId);
    const body = await request.json() as { name?: unknown; timezone?: unknown; expectedVersion?: unknown; reason?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    const reason = assertReason(body.reason);
    if (name.length < 2 || !timezonePattern.test(timezone) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new SecurityError("INVALID_FACILITY_DETAILS", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const current = await d1.prepare("SELECT f.id, f.organization_id, f.name, f.timezone, f.current_state, f.version FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id WHERE f.id = ? AND o.status = 'ACTIVE'").bind(facilityId).first<{ id: string; organization_id: string; name: string; timezone: string; current_state: string; version: number }>();
    if (!current) throw new SecurityError("FACILITY_NOT_FOUND", 404);
    const scope = `facility-details:${facilityId}`;
    const requestHash = await hashIdempotencyPayload({ facilityId, name, timezone, expectedVersion: body.expectedVersion, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (current.version !== body.expectedVersion) throw new SecurityError("STALE_FACILITY", 409);
    await requireStepUp({ purpose: "facility_update", userId: authorization.userId, targetId: facilityId, payload: { name, timezone, expectedVersion: body.expectedVersion, reason } });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { facility: { id: facilityId, organizationId: current.organization_id, name, timezone, currentState: current.current_state, version: current.version + 1 }, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM facilities WHERE id = ? AND version = ? AND name = ? AND timezone = ?)", values: [facilityId, current.version + 1, name, timezone] };
    const results = await d1.batch([
      d1.prepare("UPDATE facilities SET name = ?, timezone = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(name, timezone, now, facilityId, current.version),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId, actionType: "FACILITY_UPDATED", entityType: "facility", entityId: facilityId, reason, oldValues: { name: current.name, timezone: current.timezone }, newValues: responseBody.facility, requestId: context.requestId, correlationId, eventType: "FACILITY_UPDATED", payload: { facilityId } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("STALE_FACILITY", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
