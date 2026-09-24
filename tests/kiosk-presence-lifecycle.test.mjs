import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const preparation = fs.readFileSync("app/kiosk/visits/[visitId]/KioskPreparationClient.tsx", "utf8");
const live = fs.readFileSync("app/features/live-session/LiveSessionClient.tsx", "utf8");

test("kiosk preparation clears prisoner presence when the page is hidden or unmounted", () => {
  assert.match(preparation, /window\.addEventListener\("pagehide", onPageHide\)/);
  assert.match(preparation, /body: JSON\.stringify\(\{ presence: "absent" \}\)/);
  assert.match(preparation, /keepalive: true/);
  assert.match(preparation, /window\.removeEventListener\("pagehide", onPageHide\)/);
});

test("live kiosk clears prisoner presence when leaving the live session", () => {
  assert.match(live, /const clearPresence = \(\) =>/);
  assert.match(live, /window\.addEventListener\("pagehide", onPageHide\)/);
  assert.match(live, /body: JSON\.stringify\(\{ presence: "absent" \}\)/);
  assert.match(live, /keepalive: true/);
});
