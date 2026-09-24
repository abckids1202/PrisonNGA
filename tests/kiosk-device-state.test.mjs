import assert from "node:assert/strict";
import test from "node:test";

function persistedKioskState(cameraResult, microphoneResult, networkResult) {
  return cameraResult === "ready" && microphoneResult === "ready" && ["stable", "fair"].includes(networkResult) ? "pass" : "failed";
}

test("kiosk device checks persist failure instead of falsely marking the kiosk ready", () => {
  assert.equal(persistedKioskState("ready", "ready", "stable"), "pass");
  assert.equal(persistedKioskState("warning", "ready", "stable"), "failed");
  assert.equal(persistedKioskState("ready", "failed", "stable"), "failed");
  assert.equal(persistedKioskState("ready", "ready", "poor"), "failed");
});
