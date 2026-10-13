import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/features/control/CommandCenterPage.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const peopleSource = await readFile(new URL("../app/features/management/PeoplePage.tsx", import.meta.url), "utf8");
const dateFormatSource = await readFile(new URL("../lib/date-format.ts", import.meta.url), "utf8");
const incidentsSource = await readFile(new URL("../app/features/control/IncidentsPage.tsx", import.meta.url), "utf8");
const appointmentsSource = await readFile(new URL("../app/features/control/AppointmentsPage.tsx", import.meta.url), "utf8");
const financeSource = await readFile(new URL("../app/features/management/FinancePage.tsx", import.meta.url), "utf8");
const complianceSource = await readFile(new URL("../app/features/management/CompliancePageInteractive.tsx", import.meta.url), "utf8");

test("Control activity and People timestamps use the persisted facility timezone", () => {
  assert.match(source, /formatAuditTime\(event\.createdAt, facilityTimezone\)/);
  assert.match(shellSource, /<PeoplePage timeZone=\{facilityTimezone\} onNotify=\{notify\} \/>/);
  assert.match(peopleSource, /addLocalDateDays/);
  assert.match(peopleSource, /localDateKey/);
  assert.match(dateFormatSource, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone: safeTimeZone\(timeZone\)/);
  assert.doesNotMatch(peopleSource, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone: "Asia\/Jakarta"/);
  assert.match(peopleSource, /facilityTimeZoneLabel\(timeZone\)/);
});

test("appointment time labels come from the persisted appointment timezone", () => {
  assert.match(appointmentsSource, /appointment\.timezoneLabel \|\| facilityTimeZoneLabel\(appointment\.timezone \|\| "Asia\/Jakarta"\)/);
  assert.doesNotMatch(appointmentsSource, /appointment\.time\} WIB/);
});

test("Control record workspaces receive facility-scoped date formatting", () => {
  for (const [workspace, workspaceSource] of [["IncidentsPage", incidentsSource], ["VerificationQueue", peopleSource]]) {
    assert.match(workspaceSource, new RegExp(`function ${workspace}\\(\\{ timeZone`));
    assert.match(workspaceSource, new RegExp(`${workspace}[\\s\\S]{0,500}formatDateValueWithZone`));
  }
  assert.match(financeSource, /function FinancePage\(\{ timeZone/);
  assert.match(financeSource, /formatDateValueWithZone/);
  assert.match(complianceSource, /function CompliancePageInteractive\(\{ timeZone/);
  assert.match(complianceSource, /function ComplianceTab\(\{ timeZone/);
  assert.match(complianceSource, /formatDateValueWithZone/);
  assert.match(complianceSource, /<ComplianceTab timeZone=\{timeZone\}/);
});
