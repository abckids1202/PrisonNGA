import { SecurityError } from "./security";

export type IdempotencyReplay = { status: number; body: unknown };
export type IdempotencyClaim = { claimId: string } | { replay: IdempotencyReplay };

export async function hashIdempotencyPayload(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimIdempotency(d1: D1Database, input: { scope: string; key: string; requestHash: string }): Promise<IdempotencyClaim> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = await d1.prepare("INSERT OR IGNORE INTO idempotency_records (id, scope, idempotency_key, request_hash, status, processing_started_at, created_at) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?)")
    .bind(id, input.scope, input.key, input.requestHash, now, now).run();
  if (inserted.meta.changes) return { claimId: id };
  const existing = await d1.prepare("SELECT id, request_hash, status, response_status, response_body, processing_started_at, created_at FROM idempotency_records WHERE scope = ? AND idempotency_key = ?")
    .bind(input.scope, input.key).first<{ id: string; request_hash: string; status: string; response_status: number | null; response_body: string | null; processing_started_at: string | null; created_at: string }>();
  if (!existing) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
  if (existing.request_hash !== input.requestHash) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
  if (existing.status === "COMPLETED") {
    if (existing.response_status == null || existing.response_body == null) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
    return { replay: { status: existing.response_status, body: JSON.parse(existing.response_body) } };
  }
  if (existing.status !== "PROCESSING") throw new SecurityError("IDEMPOTENCY_IN_PROGRESS", 409);

  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  const processingStartedAt = existing.processing_started_at || existing.created_at;
  if (processingStartedAt > staleBefore) throw new SecurityError("IDEMPOTENCY_IN_PROGRESS", 409);
  const replacementId = crypto.randomUUID();
  const reclaimed = await d1.prepare("UPDATE idempotency_records SET id = ?, processing_started_at = ?, response_status = NULL, response_body = NULL, completed_at = NULL WHERE id = ? AND scope = ? AND idempotency_key = ? AND request_hash = ? AND status = 'PROCESSING' AND COALESCE(processing_started_at, created_at) <= ?")
    .bind(replacementId, now, existing.id, input.scope, input.key, input.requestHash, staleBefore).run();
  if (reclaimed.meta.changes) return { claimId: replacementId };

  const latest = await d1.prepare("SELECT id, request_hash, status, response_status, response_body FROM idempotency_records WHERE scope = ? AND idempotency_key = ?")
    .bind(input.scope, input.key).first<{ request_hash: string; status: string; response_status: number | null; response_body: string | null }>();
  if (latest?.request_hash === input.requestHash && latest.status === "COMPLETED" && latest.response_status != null && latest.response_body != null) {
    return { replay: { status: latest.response_status, body: JSON.parse(latest.response_body) } };
  }
  throw new SecurityError("IDEMPOTENCY_IN_PROGRESS", 409);
}

export function completeIdempotencyStatement(d1: D1Database, input: { claimId: string; scope: string; key: string; status: number; body: unknown; guard?: { sql: string; values: unknown[] } }): D1PreparedStatement {
  const guard = input.guard ? ` AND ${input.guard.sql}` : "";
  return d1.prepare(`UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'${guard}`)
    .bind(input.status, JSON.stringify(input.body), new Date().toISOString(), input.claimId, input.scope, input.key, ...(input.guard?.values || []));
}

export async function releaseIdempotencyClaim(d1: D1Database, input: { claimId: string; scope: string; key: string }): Promise<void> {
  await d1.prepare("DELETE FROM idempotency_records WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'")
    .bind(input.claimId, input.scope, input.key).run();
}
