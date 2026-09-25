import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../app/components/FacilityRestrictions.tsx", import.meta.url), "utf8");

test("Facility management exposes persisted operating hours and restriction controls", () => {
  assert.match(page, /tab === "Operating Hours" \|\| tab === "Visit Policies" \? <VisitPolicyEditor \/>/);
  assert.match(page, /tab === "Restrictions" \? <FacilityRestrictions/);
  assert.match(component, /Apply facility state/);
  assert.match(component, /onChange\(draft, reason\.trim\(\)\)/);
  assert.match(component, /LOCKDOWN/);
  assert.match(component, /setDraft\(normalizeState\(state\)\)/);
  assert.match(component, /Keep the selector aligned with the last persisted facility state/);
  assert.match(component, /role="alert"/);
});
