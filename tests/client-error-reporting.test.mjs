import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/diagnostics/client-error/route.ts", import.meta.url), "utf8");
const reporter = await readFile(new URL("../app/components/report-client-error.ts", import.meta.url), "utf8");

test("client error reporting is bounded, rate-limited, and privacy-safe", () => {
  assert.match(route, /enforceRateLimit/);
  assert.match(route, /CLIENT_ERROR_BOUNDARY/);
  assert.match(route, /readTextBodyWithinLimit/);
  assert.match(route, /SURFACES/);
  assert.match(route, /CLIENT_ERROR_INVALID/);
  assert.doesNotMatch(route, /body\.message/);
  assert.doesNotMatch(route, /body\.stack/);
  assert.match(reporter, /keepalive: true/);
  assert.match(reporter, /pathname/);
  assert.doesNotMatch(reporter, /error\.message/);
});
