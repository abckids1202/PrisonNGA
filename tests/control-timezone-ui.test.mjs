import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Control activity and People timestamps use the persisted facility timezone", () => {
  assert.match(source, /formatAuditTime\(event\.createdAt, facilityTimezone\)/);
  assert.match(source, /<PeoplePage timeZone=\{facilityTimezone\} onNotify=\{notify\} \/>/);
  assert.match(source, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone, year:/);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone: "Asia\/Jakarta"/);
  assert.match(source, /facilityTimeZoneLabel\(timeZone\)/);
});

test("appointment time labels come from the persisted appointment timezone", () => {
  assert.match(source, /appointment\.timezoneLabel \|\| facilityTimeZoneLabel\(appointment\.timezone \|\| "Asia\/Jakarta"\)/);
  assert.doesNotMatch(source, /appointment\.time\} WIB/);
});

test("Control record workspaces receive facility-scoped date formatting", () => {
  for (const workspace of ["IncidentsPage", "VerificationQueue", "FinancePage", "CompliancePageInteractive", "ComplianceTab"]) {
    assert.match(source, new RegExp(`function ${workspace}\\(\\{ timeZone`));
    assert.match(source, new RegExp(`${workspace}[\\s\\S]{0,500}formatDateValueWithZone`));
  }
  assert.match(source, /<ComplianceTab timeZone=\{timeZone\}/);
});
