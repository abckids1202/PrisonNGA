import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";

async function sessionCookie(token: string): Promise<string> {
  const secure = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development";
  return `securevisit_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? "; Secure" : ""}`;
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const body = await request.json() as { challengeId?: unknown; code?: unknown; displayName?: unknown };
    const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const requestedDisplayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 160) : "";
    if (!challengeId || !/^\d{6}$/.test(code)) throw new SecurityError("INVALID_AUTH_CODE", 400);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-auth:verify:${challengeId}`, limit: 10, windowSeconds: 15 * 60 });
    await enforceRateLimit(d1, { key: `visitor-auth:verify-ip:${context.ipAddress || "unknown"}`, limit: 60, windowSeconds: 15 * 60 });
    const challenge = await d1.prepare("SELECT id, channel, destination, destination_hash, expires_at, code_hash, attempt_count, max_attempts, consumed_at FROM auth_challenges WHERE id = ? AND purpose = 'VISITOR_SIGN_IN'").bind(challengeId).first<{ id: string; channel: "EMAIL" | "SMS"; destination: string; destination_hash: string; expires_at: string; code_hash: string; attempt_count: number; max_attempts: number; consumed_at: string | null }>();
    if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) throw new SecurityError("AUTH_CODE_EXPIRED", 400);
    if (challenge.attempt_count >= challenge.max_attempts) throw new SecurityError("AUTH_CODE_LOCKED", 429);
    const contactColumn = challenge.channel === "EMAIL" ? "email" : "phone";
    const existingAccount = await d1.prepare(`SELECT id, user_type, status FROM users WHERE ${contactColumn} = ?`).bind(challenge.destination).first<{ id: string; user_type: string; status: string }>();
    // Do not reveal whether a verified destination belongs to staff, a
    // disabled account, or another non-visitor record. These cases share one
    // public response so the OTP endpoint cannot be used for account
    // enumeration.
    if (existingAccount && (existingAccount.user_type !== "VISITOR" || existingAccount.status !== "ACTIVE")) throw new SecurityError("VISITOR_AUTH_UNAVAILABLE", 403);
    const salt = await getSecuritySalt();
    const codeHash = await hashIdentifier(`visitor-sign-in:${code}`, salt);
    if (codeHash !== challenge.code_hash) {
      const now = new Date().toISOString();
      const ipHash = context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null;
      const userAgentHash = context.userAgent ? await hashIdentifier(context.userAgent, salt) : null;
      const attempts = await d1.batch([
        d1.prepare("UPDATE auth_challenges SET attempt_count = attempt_count + 1 WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempt_count < max_attempts").bind(challengeId, now),
        d1.prepare("INSERT INTO security_events (id, event_type, severity, request_id, ip_hash, user_agent_hash, metadata, created_at) VALUES (?, 'VISITOR_LOGIN_CHALLENGE_FAILED', 'WARNING', ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), context.requestId, ipHash, userAgentHash, JSON.stringify({ channel: challenge.channel, challengeId, attemptCount: challenge.attempt_count + 1 }), now),
      ]);
      if (!attempts[0]?.meta.changes) throw new SecurityError("AUTH_CODE_LOCKED", 429);
      throw new SecurityError("INVALID_AUTH_CODE", 400);
    }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokenHash = await hashIdentifier(token, salt);
    const now = new Date().toISOString();
    const displayName = requestedDisplayName || (challenge.channel === "EMAIL" ? challenge.destination.split("@")[0] : `Visitor ${challenge.destination.slice(-4)}`);
    const internalEmail = challenge.channel === "EMAIL" ? challenge.destination : `visitor-${challenge.destination_hash.slice(0, 32)}@internal.securevisit.invalid`;
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const userAgentHash = context.userAgent ? await hashIdentifier(context.userAgent, salt) : null;
    const ipHash = context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null;
    const knownDevice = existingAccount?.id && userAgentHash
      ? await d1.prepare(`SELECT 1 AS known FROM auth_sessions WHERE user_id = ? AND user_agent_hash = ? AND julianday(created_at) >= julianday('now', '-30 days') LIMIT 1`).bind(existingAccount.id, userAgentHash).first()
      : null;
    const suspiciousLogin = Boolean(existingAccount?.id && userAgentHash && !knownDevice);
    const results = await d1.batch([
      d1.prepare(`UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempt_count < max_attempts AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM users WHERE ${contactColumn} = ? AND user_type <> 'VISITOR')`)
        .bind(now, challengeId, now, challenge.destination),
      d1.prepare(`INSERT INTO users (id, external_id, email, phone, display_name, user_type, status, email_verified_at, phone_verified_at, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, 'VISITOR', 'ACTIVE', ?, ?, 1, ?, ?
        WHERE EXISTS (SELECT 1 FROM auth_challenges WHERE id = ? AND consumed_at = ?)
        ON CONFLICT(${contactColumn}) DO UPDATE SET ${challenge.channel === "EMAIL" ? "email_verified_at" : "phone_verified_at"} = excluded.${challenge.channel === "EMAIL" ? "email_verified_at" : "phone_verified_at"}, display_name = CASE WHEN users.display_name = users.email OR users.display_name LIKE 'Visitor %' THEN excluded.display_name ELSE users.display_name END, updated_at = excluded.updated_at
        WHERE users.user_type = 'VISITOR' AND users.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM auth_challenges WHERE id = ? AND consumed_at = ?)`)
        .bind(userId, `visitor:${challenge.destination_hash}`, internalEmail, challenge.channel === "SMS" ? challenge.destination : null, displayName, challenge.channel === "EMAIL" ? now : null, challenge.channel === "SMS" ? now : null, now, now, challengeId, now, challengeId, now),
      d1.prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, last_seen_at, user_agent_hash, ip_hash)
        SELECT ?, id, ?, ?, ?, ?, ? FROM users
        WHERE ${contactColumn} = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'`)
        .bind(sessionId, tokenHash, sessionExpiresAt, now, userAgentHash, ipHash, challenge.destination),
      d1.prepare(`INSERT INTO security_events (id, user_id, event_type, severity, request_id, ip_hash, user_agent_hash, metadata, created_at)
        SELECT ?, id, 'VISITOR_LOGIN', 'INFO', ?, ?, ?, ?, ? FROM users
        WHERE ${contactColumn} = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'`)
        .bind(crypto.randomUUID(), context.requestId, ipHash, userAgentHash, JSON.stringify({ channel: challenge.channel }), now, challenge.destination),
      d1.prepare(`INSERT INTO security_events (id, user_id, event_type, severity, request_id, ip_hash, user_agent_hash, metadata, created_at)
        SELECT ?, id, 'VISITOR_SUSPICIOUS_LOGIN', 'WARNING', ?, ?, ?, ?, ? FROM users
        WHERE ${contactColumn} = ? AND user_type = 'VISITOR' AND status = 'ACTIVE' AND ? = 1`)
        .bind(crypto.randomUUID(), context.requestId, ipHash, userAgentHash, JSON.stringify({ channel: challenge.channel, reason: "NEW_DEVICE" }), now, challenge.destination, suspiciousLogin ? 1 : 0),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        SELECT ?, 'VISITOR_SUSPICIOUS_LOGIN', 'visitor_account', id, NULL, ?, ?, ? FROM users
        WHERE ${contactColumn} = ? AND user_type = 'VISITOR' AND status = 'ACTIVE' AND ? = 1`)
        .bind(crypto.randomUUID(), JSON.stringify({ visitorUserId: existingAccount?.id || null, channel: challenge.channel, reason: "NEW_DEVICE" }), context.requestId, now, challenge.destination, suspiciousLogin ? 1 : 0),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("AUTH_CODE_ALREADY_USED", 409);
    if (!results[2]?.meta.changes) throw new SecurityError("VISITOR_SESSION_NOT_CREATED", 500);
    if (!results[3]?.meta.changes) throw new SecurityError("VISITOR_LOGIN_AUDIT_NOT_CREATED", 500);
    const user = await d1.prepare(`SELECT id, email, phone, display_name FROM users WHERE ${contactColumn} = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'`).bind(challenge.destination).first<{ id: string; email: string | null; phone: string | null; display_name: string }>();
    if (!user) throw new SecurityError("VISITOR_ACCOUNT_NOT_CREATED", 500);
    const response = securityResponse({ authenticated: true, visitor: { id: user.id, email: challenge.channel === "EMAIL" ? user.email : null, phone: user.phone, displayName: user.display_name }, expiresAt: sessionExpiresAt }, 200, context.requestId);
    response.headers.set("Set-Cookie", await sessionCookie(token));
    return response;
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
