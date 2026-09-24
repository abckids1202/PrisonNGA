import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getD1 } from "../../../../db/runtime";
import { visitorProfiles } from "../../../../db/schema";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { parseVisitorProfileInput } from "../../../../lib/server/visitor-profile";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const db = await getDb();
    const [profile] = await db.select().from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    return securityResponse({ profile: profile || { userId: visitor.userId, legalName: visitor.displayName, preferredName: null, phone: visitor.phone, phoneVerifiedAt: visitor.phoneVerifiedAt, profileStatus: "INCOMPLETE" } }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { legalName?: unknown; preferredName?: unknown; phone?: unknown };
    const { legalName, preferredName, phone } = parseVisitorProfileInput(body);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-profile-update:${visitor.userId}`, limit: 20, windowSeconds: 60 * 60 });
    const current = await d1.prepare(`SELECT user_id, legal_name, preferred_name, phone, phone_verified_at, profile_status, version, created_at, updated_at
      FROM visitor_profiles WHERE user_id = ?`).bind(visitor.userId).first<{
      user_id: string;
      legal_name: string;
      preferred_name: string | null;
      phone: string | null;
      phone_verified_at: string | null;
      profile_status: "INCOMPLETE" | "ACTIVE" | "SUSPENDED";
      version: number;
      created_at: string;
      updated_at: string;
    }>();
    if (current?.profile_status === "SUSPENDED") throw new SecurityError("PROFILE_SUSPENDED", 403);
    const scope = `visitor-profile:${visitor.userId}`;
    const requestHash = await hashIdempotencyPayload({ legalName, preferredName, phone });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const now = new Date().toISOString();
    const phoneVerifiedAt = current?.phone === phone ? current.phone_verified_at : (!current && visitor.phone === phone ? visitor.phoneVerifiedAt : null);
    const nextVersion = current ? current.version + 1 : 1;
    const correlationId = crypto.randomUUID();
    const responseBody = {
      profile: {
        userId: visitor.userId,
        legalName,
        preferredName,
        phone,
        phoneVerifiedAt,
        profileStatus: "ACTIVE" as const,
        version: nextVersion,
        createdAt: current?.created_at ?? now,
        updatedAt: now,
      },
    };
    const mutation = current
      ? d1.prepare(`UPDATE visitor_profiles SET legal_name = ?, preferred_name = ?, phone = ?, phone_verified_at = ?, profile_status = 'ACTIVE', version = version + 1, updated_at = ?
        WHERE user_id = ? AND version = ?`).bind(legalName, preferredName, phone, phoneVerifiedAt, now, visitor.userId, current.version)
      : d1.prepare(`INSERT INTO visitor_profiles (user_id, legal_name, preferred_name, phone, phone_verified_at, profile_status, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM visitor_profiles WHERE user_id = ?)`)
        .bind(visitor.userId, legalName, preferredName, phone, phoneVerifiedAt, now, now, visitor.userId);
    const results = await d1.batch([
      mutation,
      ...auditAndOutboxStatements(d1, {
        actorUserId: visitor.userId,
        actorRole: "VISITOR",
        facilityId: null,
        actionType: "VISITOR_PROFILE_UPDATED",
        entityType: "visitor_profile",
        entityId: visitor.userId,
        reason: "Visitor profile updated.",
        oldValues: current ? { legalName: current.legal_name, preferredName: current.preferred_name, phone: current.phone ? "[REDACTED]" : null, profileStatus: current.profile_status, version: current.version } : null,
        newValues: { legalName, preferredName, phone: phone ? "[REDACTED]" : null, phoneVerifiedAt: phoneVerifiedAt ? "[SET]" : null, profileStatus: "ACTIVE", version: nextVersion },
        requestId: context.requestId,
        correlationId,
        eventType: "VISITOR_PROFILE_UPDATED",
        payload: { userId: visitor.userId, changedFields: ["legalName", "preferredName", "phone"] },
      }, { sql: current ? "changes() > 0" : "EXISTS (SELECT 1 FROM visitor_profiles WHERE user_id = ? AND version = 1 AND profile_status = 'ACTIVE')", values: current ? [] : [visitor.userId] }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: { ...responseBody, correlationId }, guard: { sql: "EXISTS (SELECT 1 FROM visitor_profiles WHERE user_id = ? AND version = ? AND profile_status = 'ACTIVE')", values: [visitor.userId, nextVersion] } }),
    ]);
    if (!results[0]?.meta.changes || !results[results.length - 1]?.meta.changes) throw new SecurityError("PROFILE_UPDATE_CONFLICT", 409);
    idempotency = null;
    return securityResponse({ ...responseBody, correlationId }, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original profile error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
