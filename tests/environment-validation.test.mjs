import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "../lib/server/config.ts";
import { evaluateReleaseGates } from "../lib/server/release-gates.ts";

test("development validation is explicit and does not require production providers", () => {
  const result = validateEnvironment({ DB: {}, SECUREVISIT_ENVIRONMENT: "development" });
  assert.equal(result.ok, true);
  assert.equal(result.environment, "development");
  assert.deepEqual(result.missing, []);
  assert.match(result.warnings.join(" "), /HASH_SALT/);
});

test("staging validation fails closed with named configuration requirements", () => {
  const result = validateEnvironment({ DB: {}, SECUREVISIT_ENVIRONMENT: "staging" });
  assert.equal(result.ok, false);
  assert.equal(result.environment, "staging");
  assert.ok(result.missing.includes("SECUREVISIT_HASH_SALT"));
  assert.ok(result.missing.includes("PAYMENT_PROVIDER=webhook"));
  assert.ok(result.missing.includes("STAFF_AUTH_PROVIDER"));
  assert.doesNotMatch(JSON.stringify(result), /secret-value|otp|token/i);
});

test("invalid environment is rejected before provider validation", () => {
  const result = validateEnvironment({ DB: {}, SECUREVISIT_ENVIRONMENT: "" });
  assert.equal(result.ok, false);
  assert.equal(result.environment, "invalid");
  assert.equal(result.missing.length, 1);
});

test("production release gates fail closed until institutional evidence is attested", () => {
  const result = evaluateReleaseGates("production", {});
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("SECUREVISIT_SECURITY_REVIEW=approved"));
  assert.ok(result.missing.includes("SECUREVISIT_BACKUP_RESTORE_DRILL=verified"));
});

test("development and staging do not require production approval attestations", () => {
  assert.equal(evaluateReleaseGates("development", {}).ready, true);
  assert.equal(evaluateReleaseGates("staging", {}).ready, true);
});
