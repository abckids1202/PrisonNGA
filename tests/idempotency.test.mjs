import assert from "node:assert/strict";
import test from "node:test";
import {
  claimIdempotency,
  completeIdempotencyStatement,
  releaseIdempotencyClaim,
} from "../lib/server/idempotency.ts";

class IdempotencyDatabase {
  records = new Map();
  guardedVersion = 1;

  prepare(sql) {
    return new IdempotencyStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class IdempotencyStatement {
  values = [];

  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO idempotency_records")) {
      const [id, scope, key, requestHash, createdAt] = this.values;
      const recordKey = `${scope}:${key}`;
      if (this.database.records.has(recordKey)) return { meta: { changes: 0 } };
      this.database.records.set(recordKey, { id, scope, key, request_hash: requestHash, status: "PROCESSING", created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE idempotency_records SET id =")) {
      const [id, createdAt, oldId, scope, key, requestHash, staleBefore] = this.values;
      const recordKey = `${scope}:${key}`;
      const record = this.database.records.get(recordKey);
      if (!record || record.id !== oldId || record.request_hash !== requestHash || record.status !== "PROCESSING" || record.created_at > staleBefore) return { meta: { changes: 0 } };
      Object.assign(record, { id, created_at: createdAt, response_status: null, response_body: null, completed_at: null });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE idempotency_records SET status = 'COMPLETED'")) {
      const [responseStatus, responseBody, completedAt, id, scope, key] = this.values;
      const record = this.database.records.get(`${scope}:${key}`);
      if (!record || record.id !== id || record.status !== "PROCESSING") return { meta: { changes: 0 } };
      if (this.sql.includes("EXISTS (SELECT 1 FROM facilities") && this.values.at(-1) !== this.database.guardedVersion) return { meta: { changes: 0 } };
      Object.assign(record, { status: "COMPLETED", response_status: responseStatus, response_body: responseBody, completed_at: completedAt });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM idempotency_records")) {
      const [id, scope, key] = this.values;
      const recordKey = `${scope}:${key}`;
      const record = this.database.records.get(recordKey);
      if (!record || record.id !== id || record.status !== "PROCESSING") return { meta: { changes: 0 } };
      this.database.records.delete(recordKey);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected SQL in idempotency test double: ${this.sql}`);
  }

  async first() {
    const [scope, key] = this.values;
    const record = this.database.records.get(`${scope}:${key}`);
    return record ? { ...record } : null;
  }
}

const request = { scope: "visitor:user-1:appointment:create", key: "request-key-0001", requestHash: "hash-1" };

test("idempotency replays the exact stored response after completion", async () => {
  const database = new IdempotencyDatabase();
  const claim = await claimIdempotency(database, request);
  assert.ok("claimId" in claim);

  const body = { appointmentId: "SV-20260922-ABC123", status: "SUBMITTED", correlationId: "corr-1" };
  await database.batch([completeIdempotencyStatement(database, { ...request, claimId: claim.claimId, status: 201, body })]);

  assert.deepEqual(await claimIdempotency(database, request), { replay: { status: 201, body } });
});

test("guarded idempotency completion refuses a stale domain version", async () => {
  const database = new IdempotencyDatabase();
  const claim = await claimIdempotency(database, request);
  assert.ok("claimId" in claim);
  const result = await database.batch([completeIdempotencyStatement(database, {
    ...request,
    claimId: claim.claimId,
    status: 200,
    body: { changed: true },
    guard: { sql: "EXISTS (SELECT 1 FROM facilities WHERE id = ? AND version = ?)", values: ["facility-1", 2] },
  })]);
  assert.equal(result[0].meta.changes, 0);
  assert.equal(database.records.get(`${request.scope}:${request.key}`).status, "PROCESSING");
});

test("idempotency rejects key reuse with a different request hash", async () => {
  const database = new IdempotencyDatabase();
  await claimIdempotency(database, request);

  await assert.rejects(
    claimIdempotency(database, { ...request, requestHash: "different-hash" }),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.statusCode === 409,
  );
});

test("a fresh in-progress claim is protected from concurrent duplicate work", async () => {
  const database = new IdempotencyDatabase();
  await claimIdempotency(database, request);

  await assert.rejects(
    claimIdempotency(database, request),
    (error) => error.code === "IDEMPOTENCY_IN_PROGRESS" && error.statusCode === 409,
  );
});

test("stale claims can be reclaimed without allowing the former owner to delete the new claim", async () => {
  const database = new IdempotencyDatabase();
  const staleId = "stale-claim";
  database.records.set(`${request.scope}:${request.key}`, {
    id: staleId,
    scope: request.scope,
    key: request.key,
    request_hash: request.requestHash,
    status: "PROCESSING",
    created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
  });

  const reclaimed = await claimIdempotency(database, request);
  assert.ok("claimId" in reclaimed);
  assert.notEqual(reclaimed.claimId, staleId);
  await releaseIdempotencyClaim(database, { ...request, claimId: staleId });
  assert.equal(database.records.get(`${request.scope}:${request.key}`).id, reclaimed.claimId);

  await releaseIdempotencyClaim(database, { ...request, claimId: reclaimed.claimId });
  assert.equal(database.records.has(`${request.scope}:${request.key}`), false);
});
