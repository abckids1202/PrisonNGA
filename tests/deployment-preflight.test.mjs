import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeploymentConfig } from "../scripts/validate-deployment.mjs";

function config(overrides = {}) {
  return {
    vars: { SECUREVISIT_ENVIRONMENT: "staging", VIDEO_PROVIDER: "livekit" },
    d1_databases: [{ binding: "DB", database_id: "123e4567-e89b-12d3-a456-426614174000" }],
    r2_buckets: [{ binding: "EVIDENCE_BUCKET", bucket_name: "securevisit-staging-evidence" }],
    triggers: { crons: ["*/1 * * * *"] },
    queues: {
      producers: [{ binding: "NOTIFICATION_QUEUE", queue: "securevisit-staging-notifications" }],
      consumers: [{ queue: "securevisit-staging-notifications", max_batch_size: 25 }],
    },
    ...overrides,
  };
}

test("deployment preflight accepts a real staging manifest", () => {
  const result = evaluateDeploymentConfig(config(), "staging", { NOTIFICATION_QUEUE_NAME: "securevisit-staging-notifications" });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("deployment preflight rejects development adapters and placeholder infrastructure", () => {
  const result = evaluateDeploymentConfig(config({
    vars: { SECUREVISIT_ENVIRONMENT: "staging", VISITOR_AUTH_DELIVERY: "console", PAYMENT_PROVIDER: "local_test" },
    d1_databases: [{ binding: "DB", database_id: "00000000-0000-4000-8000-000000000000" }],
    r2_buckets: [],
    triggers: { crons: [] },
  }), "staging");
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /development adapter/);
  assert.match(result.failures.join("\n"), /real database UUID/);
  assert.match(result.failures.join("\n"), /R2 binding/);
  assert.match(result.failures.join("\n"), /scheduled trigger/);
  assert.match(result.failures.join("\n"), /queue/i);
});

test("deployment preflight requires queue bindings when a queue is explicitly configured", () => {
  const result = evaluateDeploymentConfig(config({ queues: { producers: [], consumers: [] } }), "staging", { NOTIFICATION_QUEUE_NAME: "securevisit-staging-notifications" });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /queue binding is incomplete/);
});
