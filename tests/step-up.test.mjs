import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { consumeStepUpNonce, hashStepUpNonce, hashStepUpPayload, stepUpSigningMessage, verifyStepUpAssertion } from "../lib/server/step-up.ts";

const secret = "test-only-step-up-secret-that-is-long-enough-32-bytes";
const now = 1_800_000_000_000;
const binding = { purpose: "incident_close", userId: "staff-1", targetId: "incident-1", payload: { reason: "Reviewed and verified", expectedVersion: 4 } };
const nonce = "0123456789abcdef0123456789abcdef";

async function signedAssertion(forBinding = binding, timestamp = now, assertionNonce = nonce) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = await stepUpSigningMessage(forBinding, timestamp, assertionNonce);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  const digest = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v2.${timestamp}.${assertionNonce}.${digest}`;
}

test("step-up payload digest is stable across object key order", async () => {
  assert.equal(await hashStepUpPayload({ b: 2, a: { y: true, x: 1 } }), await hashStepUpPayload({ a: { x: 1, y: true }, b: 2 }));
  assert.notEqual(await hashStepUpNonce(nonce), await hashStepUpNonce("different-nonce"));
});

test("step-up signature is bound to actor, purpose, target, and exact action payload", async () => {
  const assertion = await signedAssertion();
  assert.ok(await verifyStepUpAssertion(secret, assertion, binding, now));
  for (const changed of [
    { ...binding, userId: "staff-2" },
    { ...binding, purpose: "facility_lockdown" },
    { ...binding, targetId: "incident-2" },
    { ...binding, payload: { reason: "Different reason", expectedVersion: 4 } },
  ]) assert.equal(await verifyStepUpAssertion(secret, assertion, changed, now), null);
});

test("step-up signature expires after the five-minute acceptance window", async () => {
  const assertion = await signedAssertion(binding, now - 5 * 60_000 - 1);
  assert.equal(await verifyStepUpAssertion(secret, assertion, binding, now), null);
});

test("step-up nonce is atomically accepted once and rejects a replay", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE step_up_assertions (nonce_hash TEXT PRIMARY KEY, actor_user_id TEXT, purpose TEXT, target_id TEXT, payload_sha256 TEXT, expires_at TEXT, created_at TEXT);");
  const d1 = {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
  const input = { nonceHash: "hashed-once", actorUserId: binding.userId, purpose: binding.purpose, targetId: binding.targetId, payloadHash: "digest", expiresAt: new Date(now + 600_000).toISOString(), createdAt: new Date(now).toISOString() };
  try {
    assert.equal(await consumeStepUpNonce(d1, input), true);
    assert.equal(await consumeStepUpNonce(d1, input), false);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM step_up_assertions").get().count, 1);
  } finally { sqlite.close(); }
});

test("simultaneous use of the same step-up nonce has exactly one winner", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE step_up_assertions (nonce_hash TEXT PRIMARY KEY, actor_user_id TEXT, purpose TEXT, target_id TEXT, payload_sha256 TEXT, expires_at TEXT, created_at TEXT);");
  const d1 = {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
  const input = { nonceHash: "same-concurrent-nonce", actorUserId: binding.userId, purpose: binding.purpose, targetId: binding.targetId, payloadHash: "digest", expiresAt: new Date(now + 600_000).toISOString(), createdAt: new Date(now).toISOString() };
  try {
    const accepted = await Promise.all([consumeStepUpNonce(d1, input), consumeStepUpNonce(d1, input)]);
    assert.deepEqual(accepted.sort(), [false, true]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM step_up_assertions").get().count, 1);
  } finally { sqlite.close(); }
});
