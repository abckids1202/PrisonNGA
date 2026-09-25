import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Control notification button reads persisted facility security events", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label="Notifications" aria-expanded=\{notificationPanelOpen\}/);
  assert.match(source, /fetch\("\/api\/control\/security-events"[\s\S]*credentials: "include", cache: "no-store"/);
  assert.match(source, /No security events recorded for this facility/);
  assert.match(source, /Security events are unavailable\. No empty notification state is being inferred/);
  assert.doesNotMatch(source, /onClick=\{\(\) => notify\("No new security notifications\."\)\}/);
});

test("notification operations expose persisted channel attempt outcomes", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /type NotificationDeliveryAttempt/);
  assert.match(source, /deliveryAttempts\?: NotificationDeliveryAttempt\[\]/);
  assert.match(source, /notificationAttemptSummary\(event\)/);
  assert.match(source, /attempt\.channel/);
  assert.match(source, /attempt\.status\.replaceAll\("_", " "\)/);
});
