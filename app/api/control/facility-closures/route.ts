import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

type ClosureRow = { id: string; facility_id: string; starts_at: string; ends_at: string; reason: string; status: "ACTIVE" | "CANCELLED"; version: number; created_by: string; created_at: string; updated_at: string };

function publicClosure(row: ClosureRow) {
  return { id: row.id, facilityId: row.facility_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason, status: row.status, version: row.version, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function parseWindow(startsAt: unknown, endsAt: unknown): { startsAt: string; endsAt: string } {
  if (typeof startsAt !== "string" || typeof endsAt !== "string") throw new SecurityError("INVALID_CLOSURE_WINDOW", 400);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new SecurityError("INVALID_CLOSURE_WINDOW", 400);
  if (end - start > 366 * 24 * 60 * 60 * 1000) throw new SecurityError("CLOSURE_WINDOW_TOO_LONG", 400);
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, facility_id, starts_at, ends_at, reason, status, version, created_by, created_at, updated_at
      FROM facility_closures WHERE facility_id = ? ORDER BY starts_at DESC LIMIT 100`).bind(authorization.facilityId).all<ClosureRow>();
    return securityResponse({ facilityId: authorization.facilityId, closures: result.results.map(publicClosure) }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { startsAt?: unknown; endsAt?: unknown; reason?: unknown };
    const window = parseWindow(body.startsAt, body.endsAt);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    await requireStepUp({ purpose: "facility_closure_create", userId: authorization.userId, targetId: authorization.facilityId, payload: { window, reason } });
    d1 = await getD1();
    const scope = `facility-closure:${authorization.facilityId}`;
    const requestHash = await hashIdempotencyPayload({ window, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { closure: { id, facilityId: authorization.facilityId, startsAt: window.startsAt, endsAt: window.endsAt, reason, status: "ACTIVE", version: 1 }, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM facility_closures WHERE id = ? AND facility_id = ? AND status = 'ACTIVE')", values: [id, authorization.facilityId] };
    const results = await d1.batch([
      d1.prepare(`INSERT INTO facility_closures (id, facility_id, starts_at, ends_at, reason, status, version, created_by, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM facility_closures WHERE facility_id = ? AND status = 'ACTIVE' AND starts_at < ? AND ends_at > ?)`)
        .bind(id, authorization.facilityId, window.startsAt, window.endsAt, reason, authorization.userId, now, now, authorization.facilityId, window.endsAt, window.startsAt),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "FACILITY_CLOSURE_CREATED", entityType: "facility_closure", entityId: id, reason, newValues: responseBody.closure, requestId: context.requestId, correlationId, eventType: "FACILITY_CLOSURE_CREATED", payload: { closureId: id, facilityId: authorization.facilityId } }, guard),
      completeIdempotencyStatement(d1, { claimId: claimed.claimId, scope, key: idempotencyKey, status: 201, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results[results.length - 1]?.meta.changes) throw new SecurityError("CLOSURE_OVERLAPS_EXISTING", 409);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function DELETE(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { closureId?: unknown; expectedVersion?: unknown; reason?: unknown };
    if (typeof body.closureId !== "string" || !body.closureId.trim() || typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion)) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    await requireStepUp({ purpose: "facility_closure_cancel", userId: authorization.userId, targetId: body.closureId, payload: { closureId: body.closureId, expectedVersion: body.expectedVersion, reason } });
    d1 = await getD1();
    const scope = `facility-closure-cancel:${authorization.facilityId}:${body.closureId.trim()}`;
    const requestHash = await hashIdempotencyPayload({ closureId: body.closureId.trim(), expectedVersion: body.expectedVersion, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { closureId: body.closureId.trim(), status: "CANCELLED", version: Number(body.expectedVersion) + 1, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM facility_closures WHERE id = ? AND facility_id = ? AND status = 'CANCELLED' AND version = ?)", values: [body.closureId.trim(), authorization.facilityId, Number(body.expectedVersion) + 1] };
    const results = await d1.batch([
      d1.prepare(`UPDATE facility_closures SET status = 'CANCELLED', version = version + 1, updated_at = ?
        WHERE id = ? AND facility_id = ? AND status = 'ACTIVE' AND version = ?`).bind(now, body.closureId.trim(), authorization.facilityId, body.expectedVersion),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "FACILITY_CLOSURE_CANCELLED", entityType: "facility_closure", entityId: body.closureId.trim(), reason, newValues: responseBody, requestId: context.requestId, correlationId, eventType: "FACILITY_CLOSURE_CANCELLED", payload: { closureId: body.closureId.trim() } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_CLOSURE", 409);
    if (!results[results.length - 1]?.meta.changes) throw new SecurityError("CLOSURE_AUDIT_FAILED", 500);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original closure error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
