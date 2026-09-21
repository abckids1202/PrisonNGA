import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const body = await request.json() as { email?: unknown };
    const email = normalizeEmail(body.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SecurityError("VALID_EMAIL_REQUIRED", 400);
    const d1 = await getD1();
    const salt = await getSecuritySalt();
    const destinationHash = await hashIdentifier(`email:${email}`, salt);
    await enforceRateLimit(d1, { key: `visitor-auth:email:${destinationHash}`, limit: 5, windowSeconds: 15 * 60 });
    await enforceRateLimit(d1, { key: `visitor-auth:ip:${context.ipAddress || "unknown"}`, limit: 30, windowSeconds: 15 * 60 });
    const recent = await d1.prepare("SELECT COUNT(*) AS count FROM auth_challenges WHERE destination_hash = ? AND created_at > datetime('now', '-15 minutes')").bind(destinationHash).first<{ count: number }>();
    if (Number(recent?.count || 0) >= 5) throw new SecurityError("AUTH_RATE_LIMITED", 429);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challengeId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const codeHash = await hashIdentifier(`visitor-sign-in:${code}`, salt);
    await d1.prepare(`INSERT INTO auth_challenges (id, channel, destination, destination_hash, destination_masked, code_hash, purpose, attempt_count, max_attempts, expires_at, created_at) VALUES (?, 'EMAIL', ?, ?, ?, ?, 'VISITOR_SIGN_IN', 0, 5, ?, ?)`).bind(challengeId, email, destinationHash, maskEmail(email), codeHash, expiresAt, now.toISOString()).run();
    const responseBody: Record<string, unknown> = { challengeId, channel: "EMAIL", destination: maskEmail(email), expiresAt, retryAfterSeconds: 60 };
    if ((await getRuntimeValue("VISITOR_AUTH_DELIVERY")) === "console") responseBody.devCode = code;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
