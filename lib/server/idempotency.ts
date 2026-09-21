import { SecurityError } from "./security";

export type IdempotencyReplay = { status: number; body: unknown };

export async function hashIdempotencyPayload(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimIdempotency(d1: D1Database, input: { scope: string; key: string; requestHash: string }): Promise<IdempotencyReplay | null> {
  const id = crypto.randomUUID();
  const inserted = await d1.prepare("INSERT OR IGNORE INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, ?, 'PROCESSING', ?)")
    .bind(id, input.scope, input.key, input.requestHash, new Date().toISOString()).run();
  if (inserted.meta.changes) return null;
  const existing = await d1.prepare("SELECT request_hash, status, response_status, response_body FROM idempotency_records WHERE scope = ? AND idempotency_key = ?")
    .bind(input.scope, input.key).first<{ request_hash: string; status: string; response_status: number | null; response_body: string | null }>();
  if (!existing) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
  if (existing.request_hash !== input.requestHash) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
  if (existing.status !== "COMPLETED" || existing.response_status == null || existing.response_body == null) throw new SecurityError("IDEMPOTENCY_IN_PROGRESS", 409);
  return { status: existing.response_status, body: JSON.parse(existing.response_body) };
}

export async function completeIdempotency(d1: D1Database, input: { scope: string; key: string; status: number; body: unknown }): Promise<void> {
  await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE scope = ? AND idempotency_key = ? AND status = 'PROCESSING'")
    .bind(input.status, JSON.stringify(input.body), new Date().toISOString(), input.scope, input.key).run();
}
