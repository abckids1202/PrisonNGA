import test from "node:test";
import assert from "node:assert/strict";
import { describeDevice } from "../lib/server/auth/device-label.ts";

test("session device labels are coarse and useful without persisting raw user agents", () => {
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone or iPad");
  assert.equal(describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"), "Firefox on Linux");
  assert.equal(describeDevice(null), null);
});

test("visitor session records store a device label and expose it through the session API", async () => {
  const { readFile } = await import("node:fs/promises");
  const verifyRoute = await readFile(new URL("../app/api/auth/visitor/verify/route.ts", import.meta.url), "utf8");
  const sessionsRoute = await readFile(new URL("../app/api/auth/sessions/route.ts", import.meta.url), "utf8");
  assert.match(verifyRoute, /device_label/);
  assert.match(verifyRoute, /describeDevice\(context\.userAgent\)/);
  assert.match(sessionsRoute, /authSessions\.deviceLabel/);
  assert.match(sessionsRoute, /session\.deviceLabel \|\|/);
});
