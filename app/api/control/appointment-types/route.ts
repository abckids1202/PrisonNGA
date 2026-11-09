import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, code, display_name, description, duration_minutes, credit_cost, status, version, updated_at
      FROM appointment_types WHERE facility_id = ? ORDER BY display_name ASC`).bind(authorization.facilityId).all();
    return securityResponse({ facilityId: authorization.facilityId, appointmentTypes: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("appointment_type.manage");
    const body = await request.json() as { code?: unknown; displayName?: unknown; description?: unknown; durationMinutes?: unknown; creditCost?: unknown; reason?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const durationMinutes = Number(body.durationMinutes);
    const creditCost = Number(body.creditCost);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Z0-9]+(?:[_:-][A-Z0-9]+)*$/.test(code) || code.length > 64 || !displayName || displayName.length > 120 || !description || description.length > 500 || !Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 120 || durationMinutes % 15 !== 0 || !Number.isSafeInteger(creditCost) || creditCost < 1 || creditCost > 10) throw new SecurityError("INVALID_APPOINTMENT_TYPE", 400);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?").bind(authorization.facilityId).first<{ organization_id: string | null }>();
    if (!facility?.organization_id) throw new SecurityError("FACILITY_ORGANIZATION_NOT_FOUND", 404);
    const duplicate = await d1.prepare("SELECT id FROM appointment_types WHERE facility_id = ? AND code = ?").bind(authorization.facilityId, code).first();
    if (duplicate) throw new SecurityError("APPOINTMENT_TYPE_CODE_IN_USE", 409);
    const scope = `appointment-type-create:${authorization.facilityId}:${code}`;
    const requestHash = await hashIdempotencyPayload({ facilityId: authorization.facilityId, code, displayName, description, durationMinutes, creditCost, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "appointment_type_create", userId: authorization.userId, targetId: authorization.facilityId, payload: { code, displayName, durationMinutes, creditCost, reason } });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const snapshot = { id, facilityId: authorization.facilityId, code, displayName, description, durationMinutes, creditCost, status: "ACTIVE", version: 1, updatedAt: now };
    const responseBody = { appointmentType: snapshot, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM appointment_types WHERE id = ? AND facility_id = ? AND version = 1)", values: [id, authorization.facilityId] };
    const results = await d1.batch([
      d1.prepare(`INSERT INTO appointment_types (id, organization_id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`).bind(id, facility.organization_id, authorization.facilityId, code, displayName, description, durationMinutes, creditCost, now, now),
      d1.prepare(`INSERT INTO appointment_type_history (id, appointment_type_id, facility_id, version, actor_user_id, reason, snapshot, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, authorization.facilityId, authorization.userId, reason, JSON.stringify(snapshot), now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "APPOINTMENT_TYPE_CREATED", entityType: "appointment_type", entityId: id, reason, newValues: snapshot, requestId: context.requestId, correlationId, eventType: "APPOINTMENT_TYPE_CREATED", payload: { appointmentTypeId: id, code } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard }),
    ]);
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("APPOINTMENT_TYPE_CREATE_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("appointment_type.manage");
    const body = await request.json() as { id?: unknown; expectedVersion?: unknown; displayName?: unknown; description?: unknown; durationMinutes?: unknown; creditCost?: unknown; status?: unknown; reason?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const durationMinutes = Number(body.durationMinutes);
    const creditCost = Number(body.creditCost);
    const status = body.status === "ACTIVE" || body.status === "INACTIVE" ? body.status : "";
    const expectedVersion = Number(body.expectedVersion);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!id || !displayName || displayName.length > 120 || !description || description.length > 500 || !Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 120 || durationMinutes % 15 !== 0 || !Number.isSafeInteger(creditCost) || creditCost < 1 || creditCost > 10 || !status || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new SecurityError("INVALID_APPOINTMENT_TYPE", 400);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const database = await getD1();
    d1 = database;
    const current = await database.prepare(`SELECT id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version, updated_at
      FROM appointment_types WHERE id = ? AND facility_id = ?`).bind(id, authorization.facilityId).first<Record<string, string | number>>();
    if (!current) throw new SecurityError("APPOINTMENT_TYPE_NOT_FOUND", 404);
    const scope = `appointment-type:${authorization.facilityId}:${id}`;
    const next = { displayName, description, durationMinutes, creditCost, status, version: expectedVersion + 1 };
    const requestHash = await hashIdempotencyPayload({ id, expectedVersion, ...next, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (Number(current.version) !== expectedVersion) throw new SecurityError("STALE_APPOINTMENT_TYPE", 409);
    await requireStepUp({ purpose: "appointment_type_change", userId: authorization.userId, targetId: id, payload: { id, expectedVersion, ...next, reason } });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const snapshot = { id, facilityId: authorization.facilityId, code: current.code, ...next, updatedAt: now };
    const responseBody = { appointmentType: snapshot, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM appointment_types WHERE id = ? AND facility_id = ? AND version = ?)", values: [id, authorization.facilityId, expectedVersion + 1] };
    const results = await database.batch([
      database.prepare(`UPDATE appointment_types SET display_name = ?, description = ?, duration_minutes = ?, credit_cost = ?, status = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND facility_id = ? AND version = ?`).bind(displayName, description, durationMinutes, creditCost, status, now, id, authorization.facilityId, expectedVersion),
      database.prepare(`INSERT INTO appointment_type_history (id, appointment_type_id, facility_id, version, actor_user_id, reason, snapshot, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(crypto.randomUUID(), id, authorization.facilityId, expectedVersion + 1, authorization.userId, reason, JSON.stringify(snapshot), now),
      ...auditAndOutboxStatements(database, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "APPOINTMENT_TYPE_UPDATED", entityType: "appointment_type", entityId: id, reason, oldValues: current, newValues: snapshot, requestId: context.requestId, correlationId, eventType: "APPOINTMENT_TYPE_UPDATED", payload: { appointmentTypeId: id, code: current.code, status } }, guard),
      completeIdempotencyStatement(database, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("STALE_APPOINTMENT_TYPE", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original catalog error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
