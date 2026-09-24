import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("appointment decisions are replay-safe across approval and recovery branches", async () => {
  const source = await readFile(new URL("../app/api/control/appointments/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /releaseIdempotencyClaim\(d1, idempotency\)/);
  assert.match(source, /appointmentDecisionStatements/);
  assert.match(source, /IDEMPOTENCY_RETRY_REQUIRED/);
  assert.match(source, /getAssignedResources/);
  const clientSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(clientSource, /appointment-decision-\$\{id\}-\$\{command\}/);
  assert.match(clientSource, /staff-provision-\$\{crypto\.randomUUID\(\)\}/);
});
