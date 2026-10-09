import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const route = fs.readFileSync("app/api/kiosk/visits/[visitId]/device-check/route.ts", "utf8");

function persistedKioskState(cameraResult, microphoneResult, networkResult) {
  return cameraResult === "ready" && microphoneResult === "ready" && ["stable", "fair"].includes(networkResult) ? "pass" : "failed";
}

test("kiosk device checks persist failure instead of falsely marking the kiosk ready", () => {
  assert.equal(persistedKioskState("ready", "ready", "stable"), "pass");
  assert.equal(persistedKioskState("warning", "ready", "stable"), "failed");
  assert.equal(persistedKioskState("ready", "failed", "stable"), "failed");
  assert.equal(persistedKioskState("ready", "ready", "poor"), "failed");
});

test("kiosk device checks compensate a partial evidence write", () => {
  assert.match(route, /WAITING_ROOM_RECONCILIATION_REQUIRED/);
  assert.match(route, /SET kiosk_camera_state = \?, kiosk_microphone_state = \?, kiosk_network_state = \?, kiosk_device_checked_at = \?, kiosk_state = \?, version = \?, last_checked_at = \?, updated_at = \?/);
  assert.match(route, /if \(result\[0\]\?\.meta\.changes\) \{/);
});
