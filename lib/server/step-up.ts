export type StepUpBinding = {
  purpose: string;
  userId: string;
  targetId: string;
  payload: unknown;
};

export type ParsedStepUpAssertion = {
  timestamp: number;
  nonce: string;
  signature: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashStepUpPayload(payload: unknown): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(payload)))));
}

export async function hashStepUpNonce(nonce: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))));
}

export function parseStepUpAssertion(value: string): ParsedStepUpAssertion | null {
  const match = /^v2\.(\d{13})\.([A-Za-z0-9_-]{16,128})\.([a-f0-9]{64})$/i.exec(value);
  if (!match) return null;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return null;
  return { timestamp, nonce: match[2], signature: match[3].toLowerCase() };
}

export async function stepUpSigningMessage(binding: StepUpBinding, timestamp: number, nonce: string): Promise<string> {
  return JSON.stringify(["securevisit-step-up-v2", binding.purpose, binding.userId, binding.targetId, await hashStepUpPayload(binding.payload), timestamp, nonce]);
}

export async function verifyStepUpAssertion(secret: string, assertion: string, binding: StepUpBinding, now = Date.now()): Promise<ParsedStepUpAssertion | null> {
  const parsed = parseStepUpAssertion(assertion);
  if (!parsed || !secret || secret.length < 32 || Math.abs(now - parsed.timestamp) > 5 * 60_000) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(parsed.signature.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
  const message = await stepUpSigningMessage(binding, parsed.timestamp, parsed.nonce);
  if (!await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(message))) return null;
  return parsed;
}

export async function consumeStepUpNonce(d1: D1Database, input: { nonceHash: string; actorUserId: string; purpose: string; targetId: string; payloadHash: string; expiresAt: string; createdAt: string }): Promise<boolean> {
  const result = await d1.prepare(`INSERT OR IGNORE INTO step_up_assertions
    (nonce_hash, actor_user_id, purpose, target_id, payload_sha256, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.nonceHash, input.actorUserId, input.purpose, input.targetId, input.payloadHash, input.expiresAt, input.createdAt)
    .run();
  return result.meta.changes === 1;
}
