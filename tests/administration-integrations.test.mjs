import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Administration integrations tab reads protected readiness state", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /function IntegrationReadinessPanel/);
  assert.match(source, /fetch\("\/api\/health\/readiness"/);
  assert.match(source, /providerConfiguration/);
  assert.match(source, /releaseGates/);
  assert.match(source, /Institutional launch gates/);
  assert.match(source, /Launch remains blocked/);
  assert.match(source, /createReconciliationIncident/);
  assert.match(source, /security-event-incident-/);
  assert.match(source, /Create incident/);
  assert.match(source, /linkedIncidentId/);
  assert.match(source, /sourceSecurityEventId: event.id/);
  assert.match(source, /Secret values are never returned/);
  assert.match(source, /tab === "Integrations" \? <IntegrationReadinessPanel/);
});
