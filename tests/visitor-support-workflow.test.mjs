import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("visitor support is persisted through the facility incident workflow", async () => {
  const source = await readFile(new URL("../app/api/visitor/support/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireVisitorIdentity\(\)/);
  assert.match(source, /createIncidentStatements\(d1/);
  assert.match(source, /incidentType: "VISITOR_SUPPORT"/);
  assert.match(source, /enforceRateLimit\(d1, \{ key: `visitor-support:/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /appointmentId = typeof body\.appointmentId/);
  assert.match(source, /WHERE i\.reporter_user_id = \? AND i\.incident_type = 'VISITOR_SUPPORT'/);
});

test("staff incident queries include visitor-reported cases", async () => {
  const source = await readFile(new URL("../app/api/control/incidents/route.ts", import.meta.url), "utf8");
  assert.match(source, /LEFT JOIN users reporter ON reporter\.id = i\.reporter_user_id/);
  assert.match(source, /reporter\.user_type AS reporter_type/);
  assert.doesNotMatch(source, /INNER JOIN users reporter ON reporter\.id = i\.reporter_user_id AND reporter\.user_type = 'STAFF'/);
});

test("visitor support outbox events resolve the visitor and use dedicated notification copy", async () => {
  const outbox = await readFile(new URL("../lib/server/notifications/outbox.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(outbox, /row\.aggregate_type === "incident"/);
  assert.match(outbox, /i\.incident_type = 'VISITOR_SUPPORT'/);
  assert.match(worker, /eventType === "VISITOR_SUPPORT_CREATED"/);
});
