import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";
import { deliverVisitorChallenge } from "../../../../../lib/server/visitor-auth/delivery";

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\s().-]/g, "") : "";
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}••••${phone.slice(-2)}`;
}

function generateCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const bytes = new Uint32Array(1);
  do crypto.getRandomValues(bytes); while (bytes[0] >= limit);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { phone?: unknown };
    const phone = normalizePhone(body.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new SecurityError("PHONE_FORMAT_INVALID", 400);
    const d1 = await getD1();
    const salt = await getSecuritySalt();
    await enforceRateLimit(d1, { key: `visitor-phone-verification:${visitor.userId}`, limit: 5, windowSeconds: 15 * 60 });
    const owner = await d1.prepare("SELECT id, phone, phone_verified_at FROM users WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(visitor.userId).first<{ id: string; phone: string | null; phone_verified_at: string | null }>();
    if (!owner) throw new SecurityError("VISITOR_ACCOUNT_NOT_FOUND", 404);
    if (owner.phone === phone && owner.phone_verified_at) return securityResponse({ alreadyVerified: true, destination: maskPhone(phone) }, 200, context.requestId);
    // `users.phone` is globally unique, including staff and disabled records.
    // Keep the response generic so this does not become an account-enumeration
    // oracle, while still failing before the later unique-index write.
    const conflict = await d1.prepare("SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1").bind(phone, visitor.userId).first();
    if (conflict) throw new SecurityError("PHONE_ALREADY_IN_USE", 409);
    const destinationHash = await hashIdentifier(`sms:${phone}`, salt);
    const recent = await d1.prepare("SELECT COUNT(*) AS count FROM auth_challenges WHERE user_id = ? AND purpose = 'CONTACT_VERIFICATION' AND julianday(created_at) > julianday('now', '-15 minutes')").bind(visitor.userId).first<{ count: number }>();
    if (Number(recent?.count || 0) >= 5) throw new SecurityError("AUTH_RATE_LIMITED", 429);
    const code = generateCode();
    const challengeId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const codeHash = await hashIdentifier(`visitor-contact-verification:${visitor.userId}:${code}`, salt);
    const inserted = await d1.prepare(`INSERT INTO auth_challenges (id, user_id, channel, destination, destination_hash, destination_masked, code_hash, purpose, attempt_count, max_attempts, expires_at, created_at)
      SELECT ?, ?, 'SMS', ?, ?, ?, ?, 'CONTACT_VERIFICATION', 0, 5, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM auth_challenges WHERE user_id = ? AND purpose = 'CONTACT_VERIFICATION' AND consumed_at IS NULL AND julianday(created_at) > julianday('now', '-60 seconds'))`)
      .bind(challengeId, visitor.userId, phone, destinationHash, maskPhone(phone), codeHash, expiresAt, now.toISOString(), visitor.userId).run();
    if (!inserted.meta.changes) throw new SecurityError("AUTH_RETRY_TOO_SOON", 429);
    const delivery = (await getRuntimeValue("VISITOR_AUTH_DELIVERY") || "").toLowerCase();
    const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
    const attemptId = crypto.randomUUID();
    await d1.prepare("INSERT INTO auth_challenge_delivery_attempts (id, challenge_id, channel, provider, status, attempt_count, started_at) VALUES (?, ?, 'SMS', ?, 'PENDING', 1, ?)").bind(attemptId, challengeId, delivery || "unconfigured", now.toISOString()).run();
    if (delivery === "console" && environment === "development") {
      await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'SENT', completed_at = ? WHERE id = ?").bind(new Date().toISOString(), attemptId).run();
      return securityResponse({ challengeId, destination: maskPhone(phone), expiresAt, retryAfterSeconds: 60, devCode: code }, 201, context.requestId);
    }
    if (delivery !== "webhook") {
      await d1.batch([
        d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'FAILED', error_code = 'AUTH_DELIVERY_NOT_CONFIGURED', completed_at = ? WHERE id = ?").bind(new Date().toISOString(), attemptId),
        d1.prepare("UPDATE auth_challenges SET expires_at = ? WHERE id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), challengeId),
      ]);
      throw new SecurityError("AUTH_DELIVERY_NOT_CONFIGURED", 503);
    }
    try {
      await deliverVisitorChallenge({ channel: "SMS", challengeId, destination: phone, code, expiresAt });
    } catch {
      await d1.batch([
        d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'FAILED', error_code = 'AUTH_DELIVERY_UNAVAILABLE', completed_at = ? WHERE id = ?").bind(new Date().toISOString(), attemptId),
        d1.prepare("UPDATE auth_challenges SET expires_at = ? WHERE id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), challengeId),
      ]);
      throw new SecurityError("AUTH_DELIVERY_UNAVAILABLE", 503);
    }
    await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'SENT', completed_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), attemptId).run();
    return securityResponse({ challengeId, destination: maskPhone(phone), expiresAt, retryAfterSeconds: 60 }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { challengeId?: unknown; code?: unknown };
    const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!challengeId || !/^\d{6}$/.test(code)) throw new SecurityError("AUTH_CODE_INVALID", 400);
    d1 = await getD1();
    const database = d1;
    const salt = await getSecuritySalt();
    const challenge = await database.prepare("SELECT id, user_id, destination, code_hash, attempt_count, max_attempts, expires_at, consumed_at FROM auth_challenges WHERE id = ? AND user_id = ? AND purpose = 'CONTACT_VERIFICATION' AND channel = 'SMS'").bind(challengeId, visitor.userId).first<{ id: string; user_id: string; destination: string; code_hash: string; attempt_count: number; max_attempts: number; expires_at: string; consumed_at: string | null }>();
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) throw new SecurityError("AUTH_CODE_EXPIRED", 400);
    const expected = await hashIdentifier(`visitor-contact-verification:${visitor.userId}:${code}`, salt);
    if (expected !== challenge.code_hash) {
      const failed = await database.prepare("UPDATE auth_challenges SET attempt_count = attempt_count + 1 WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND attempt_count < max_attempts").bind(challengeId, visitor.userId).run();
      if (!failed.meta.changes || challenge.attempt_count + 1 >= challenge.max_attempts) throw new SecurityError("AUTH_CODE_LOCKED", 429);
      throw new SecurityError("INVALID_AUTH_CODE", 400);
    }
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await database.batch([
      database.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ? AND attempt_count < max_attempts").bind(now, challengeId, visitor.userId, now),
      // The ownership check happened when the challenge was issued. The
      // authenticated visitor may be replacing an older verified number, so
      // do not require the old value to be null or equal to the new one here.
      database.prepare("UPDATE users SET phone = ?, phone_verified_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(challenge.destination, now, now, visitor.userId),
      database.prepare("UPDATE visitor_profiles SET phone = ?, phone_verified_at = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND profile_status = 'ACTIVE'").bind(challenge.destination, now, now, visitor.userId),
      ...auditAndOutboxStatements(database, { actorUserId: visitor.userId, actorRole: "VISITOR", facilityId: null, actionType: "VISITOR_PHONE_VERIFIED", entityType: "visitor_profile", entityId: visitor.userId, reason: "Visitor verified ownership of a phone contact.", oldValues: null, newValues: { phone: "[REDACTED]", phoneVerifiedAt: "[SET]" }, requestId: context.requestId, correlationId, eventType: "VISITOR_PHONE_VERIFIED", payload: { userId: visitor.userId, channel: "SMS" } }),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) throw new SecurityError("CONTACT_VERIFICATION_CONFLICT", 409);
    return securityResponse({ verified: true, phoneVerifiedAt: now, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
