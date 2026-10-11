import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Control activity and People timestamps use the persisted facility timezone", () => {
  assert.match(source, /formatAuditTime\(event\.createdAt, facilityTimezone\)/);
  assert.match(source, /<PeoplePage timeZone=\{facilityTimezone\} onNotify=\{notify\} \/>/);
  assert.match(source, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone, year:/);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone: "Asia\/Jakarta"/);
});
