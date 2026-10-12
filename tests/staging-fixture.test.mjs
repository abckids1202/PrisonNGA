import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/d1-staging-fixture.mjs", import.meta.url), "utf8");
const fixture = await readFile(new URL("../db/staging-fixture.sql", import.meta.url), "utf8");
const verifier = await readFile(new URL("../scripts/verify-release.mjs", import.meta.url), "utf8");

test("staging fixture refuses unsafe environments and requires explicit confirmation", () => {
  assert.match(script, /--confirm-staging-fixture/);
  assert.match(script, /SECUREVISIT_ENVIRONMENT=staging/);
  assert.match(script, /localPlaceholder/);
  assert.match(script, /--remote/);
  assert.doesNotMatch(script, /--local/);
});

test("staging fixture contains synthetic infrastructure but no credentials or private evidence", () => {
  assert.match(fixture, /facility-staging-001/);
  assert.match(fixture, /prisoner-staging-001/);
  assert.match(fixture, /kiosk-staging-01/);
  assert.doesNotMatch(fixture, /kiosk_credentials/);
  assert.doesNotMatch(fixture, /auth_sessions/);
  assert.doesNotMatch(fixture, /payment_intents/);
  assert.doesNotMatch(fixture, /INSERT[^\n]+evidence/i);
});

test("release verification executes the fixture against a disposable migrated database", () => {
  assert.match(verifier, /db:test:staging-fixture/);
});
