import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";

async function sessionCookie(token: string): Promise<string> {
  const secure = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) === "production";
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
    const challenge = await d1.prepare("SELECT id, destination, destination_hash, expires_at, code_hash, attempt_count, max_attempts, consumed_at FROM auth_challenges WHERE id = ? AND purpose = 'VISITOR_SIGN_IN'").bind(challengeId).first<{ id: string; destination: string; destination_hash: string; expires_at: string; code_hash: string; attempt_count: number; max_attempts: number; consumed_at: string | null }>();
    if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) throw new SecurityError("AUTH_CODE_EXPIRED", 400);
    if (challenge.attempt_count >= challenge.max_attempts) throw new SecurityError("AUTH_CODE_LOCKED", 429);
    const existingAccount = await d1.prepare("SELECT user_type, status FROM users WHERE email = ?").bind(challenge.destination).first<{ user_type: string; status: string }>();
    if (existingAccount && existingAccount.user_type !== "VISITOR") throw new SecurityError("VISITOR_ACCOUNT_CONFLICT", 409);
    if (existingAccount && existingAccount.status !== "ACTIVE") throw new SecurityError("VISITOR_ACCOUNT_DISABLED", 403);
    const salt = await getSecuritySalt();
    const codeHash = await hashIdentifier(`visitor-sign-in:${code}`, salt);
    if (codeHash !== challenge.code_hash) {
      await d1.prepare("UPDATE auth_challenges SET attempt_count = attempt_count + 1 WHERE id = ?").bind(challengeId).run();
      throw new SecurityError("INVALID_AUTH_CODE", 400);
    }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokenHash = await hashIdentifier(token, salt);
    const now = new Date().toISOString();
    const displayName = requestedDisplayName || challenge.destination.split("@")[0];
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const userAgentHash = context.userAgent ? await hashIdentifier(context.userAgent, salt) : null;
    const ipHash = context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null;
    const results = await d1.batch([
      d1.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempt_count < max_attempts AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM users WHERE email = ? AND user_type <> 'VISITOR')")
        .bind(now, challengeId, now, challenge.destination),
      d1.prepare(`INSERT INTO users (id, external_id, email, display_name, user_type, status, email_verified_at, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'VISITOR', 'ACTIVE', ?, 1, ?, ?
        WHERE EXISTS (SELECT 1 FROM auth_challenges WHERE id = ? AND consumed_at = ?)
        ON CONFLICT(email) DO UPDATE SET email_verified_at = excluded.email_verified_at, display_name = CASE WHEN users.display_name = users.email THEN excluded.display_name ELSE users.display_name END, updated_at = excluded.updated_at
        WHERE users.user_type = 'VISITOR' AND users.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM auth_challenges WHERE id = ? AND consumed_at = ?)`)
        .bind(userId, `visitor:${challenge.destination_hash}`, challenge.destination, displayName, now, now, now, challengeId, now, challengeId, now),
      d1.prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, last_seen_at, user_agent_hash, ip_hash)
        SELECT ?, id, ?, ?, ?, ?, ? FROM users
        WHERE email = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'`)
        .bind(sessionId, tokenHash, sessionExpiresAt, now, userAgentHash, ipHash, challenge.destination),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("AUTH_CODE_ALREADY_USED", 409);
    if (!results[2]?.meta.changes) throw new SecurityError("VISITOR_SESSION_NOT_CREATED", 500);
    const user = await d1.prepare("SELECT id, email, display_name FROM users WHERE email = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(challenge.destination).first<{ id: string; email: string; display_name: string }>();
    if (!user) throw new SecurityError("VISITOR_ACCOUNT_NOT_CREATED", 500);
    const response = securityResponse({ authenticated: true, visitor: { id: user.id, email: user.email, displayName: user.display_name }, expiresAt: sessionExpiresAt }, 200, context.requestId);
    response.headers.set("Set-Cookie", await sessionCookie(token));
    return response;
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
