import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Administration integrations tab reads protected readiness state", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const readinessSource = await readFile(new URL("../app/features/management/IntegrationReadinessPanel.tsx", import.meta.url), "utf8");
  assert.match(readinessSource, /function IntegrationReadinessPanel/);
  assert.match(readinessSource, /fetch\("\/api\/health\/readiness"/);
  assert.match(readinessSource, /providerConfiguration/);
  assert.match(readinessSource, /providerAdapters/);
  assert.match(readinessSource, /Active adapters/);
  assert.match(readinessSource, /releaseGates/);
  assert.match(readinessSource, /Institutional launch gates/);
  assert.match(readinessSource, /Launch remains blocked/);
  assert.match(source, /createReconciliationIncident/);
  assert.match(source, /security-event-incident-/);
  assert.match(source, /Create incident/);
  assert.match(source, /linkedIncidentId/);
  assert.match(source, /sourceSecurityEventId: event.id/);
  assert.match(readinessSource, /Secret values are never returned/);
  assert.match(source, /tab === "Integrations" \? <IntegrationReadinessPanel/);
});
