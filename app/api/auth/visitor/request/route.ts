import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";
import { deliverVisitorChallenge } from "../../../../../lib/server/visitor-auth/delivery";

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\s().-]/g, "") : "";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}••••${phone.slice(-2)}`;
}

function generateCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const body = await request.json() as { email?: unknown; phone?: unknown; channel?: unknown };
    const requestedChannel = typeof body.channel === "string" ? body.channel.trim().toUpperCase() : "";
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const channel = requestedChannel || "EMAIL";
    const destination = channel === "EMAIL" ? email : phone;
    if (channel === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SecurityError("VALID_EMAIL_REQUIRED", 400);
    if (channel === "SMS" && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new SecurityError("VALID_PHONE_REQUIRED", 400);
    if (channel !== "EMAIL" && channel !== "SMS") throw new SecurityError("AUTH_CHANNEL_INVALID", 400);
    const d1 = await getD1();
    const salt = await getSecuritySalt();
    const destinationHash = await hashIdentifier(`${channel.toLowerCase()}:${destination}`, salt);
    await enforceRateLimit(d1, { key: `visitor-auth:${channel.toLowerCase()}:${destinationHash}`, limit: 5, windowSeconds: 15 * 60 });
    await enforceRateLimit(d1, { key: `visitor-auth:ip:${context.ipAddress || "unknown"}`, limit: 30, windowSeconds: 15 * 60 });
    const recent = await d1.prepare("SELECT COUNT(*) AS count FROM auth_challenges WHERE destination_hash = ? AND purpose = 'VISITOR_SIGN_IN' AND julianday(created_at) > julianday('now', '-15 minutes')").bind(destinationHash).first<{ count: number }>();
    if (Number(recent?.count || 0) >= 5) throw new SecurityError("AUTH_RATE_LIMITED", 429);
    const code = generateCode();
    const challengeId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const codeHash = await hashIdentifier(`visitor-sign-in:${code}`, salt);
    const inserted = await d1.prepare(`INSERT INTO auth_challenges (id, channel, destination, destination_hash, destination_masked, code_hash, purpose, attempt_count, max_attempts, expires_at, created_at)
      SELECT ?, ?, ?, ?, ?, ?, 'VISITOR_SIGN_IN', 0, 5, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM auth_challenges
        WHERE destination_hash = ? AND purpose = 'VISITOR_SIGN_IN'
          AND julianday(created_at) > julianday('now', '-60 seconds')
      )`).bind(challengeId, channel, destination, destinationHash, channel === "EMAIL" ? maskEmail(email) : maskPhone(phone), codeHash, expiresAt, now.toISOString(), destinationHash).run();
    if (!inserted.meta.changes) throw new SecurityError("AUTH_RETRY_TOO_SOON", 429);
    const responseBody: Record<string, unknown> = { challengeId, channel, destination: channel === "EMAIL" ? maskEmail(email) : maskPhone(phone), expiresAt, retryAfterSeconds: 60 };
    const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
    const delivery = (await getRuntimeValue("VISITOR_AUTH_DELIVERY") || "").toLowerCase();
    const deliveryAttemptId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await d1.prepare("INSERT INTO auth_challenge_delivery_attempts (id, challenge_id, channel, provider, status, attempt_count, started_at) VALUES (?, ?, ?, ?, 'PENDING', 1, ?)").bind(deliveryAttemptId, challengeId, channel, delivery || "unconfigured", startedAt).run();
    if (delivery === "console" && environment === "development") {
      responseBody.devCode = code;
      await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'SENT', completed_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), deliveryAttemptId).run();
    } else if (delivery === "webhook") {
      try {
        await deliverVisitorChallenge({ channel: channel as "EMAIL" | "SMS", challengeId, destination, code, expiresAt });
      } catch {
        await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'FAILED', error_code = 'AUTH_DELIVERY_UNAVAILABLE', completed_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), deliveryAttemptId).run();
        await d1.prepare("UPDATE auth_challenges SET expires_at = ? WHERE id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), challengeId).run();
        throw new SecurityError("AUTH_DELIVERY_UNAVAILABLE", 503);
      }
      await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'SENT', completed_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), deliveryAttemptId).run();
    } else {
      await d1.prepare("UPDATE auth_challenge_delivery_attempts SET status = 'FAILED', error_code = 'AUTH_DELIVERY_NOT_CONFIGURED', completed_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), deliveryAttemptId).run();
      await d1.prepare("UPDATE auth_challenges SET expires_at = ? WHERE id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), challengeId).run();
      throw new SecurityError("AUTH_DELIVERY_NOT_CONFIGURED", 503);
    }
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
