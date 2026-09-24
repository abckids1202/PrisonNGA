import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Administration integrations tab reads protected readiness state", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /function IntegrationReadinessPanel/);
  assert.match(source, /fetch\("\/api\/health\/readiness"/);
  assert.match(source, /providerConfiguration/);
  assert.match(source, /Secret values are never returned/);
  assert.match(source, /tab === "Integrations" \? <IntegrationReadinessPanel/);
});
