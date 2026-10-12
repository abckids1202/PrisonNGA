import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Live Session end retries reuse the session-version idempotency boundary", async () => {
  const source = await readFile(new URL("../app/features/live-session/LiveSessionsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /\"Idempotency-Key\": `live-session-end-\$\{session\.id\}-\$\{session\.version\}`/);
  assert.doesNotMatch(source, /live-session-end-\$\{crypto\.randomUUID\(\)\}/);
});
