import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor notification clicks route persisted visit, payment, and relationship updates", async () => {
  const source = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(source, /notificationDestination\(notification: VisitorNotification\)/);
  assert.match(source, /tab: "Visits"/);
  assert.match(source, /tab: "Credits"/);
  assert.match(source, /tab: "Connections"/);
  assert.match(source, /onNavigate\(destination\.tab\)/);
  assert.match(source, /onNavigate={navigate}/);
  assert.match(source, /onClick=\{\(\) => void openNotification\(notification\)\}/);
});
