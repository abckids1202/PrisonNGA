import assert from "node:assert/strict";
import test from "node:test";
import { liveSessionOutcome, nextLiveSessionViewStage, remoteSessionPerson } from "../lib/visitor/live-session-state.ts";

test("scheduled time expiry enters confirmation and never claims completion without persisted outcome", () => {
  assert.equal(nextLiveSessionViewStage("active", { remainingSeconds: 0 }), "confirming");
  assert.notEqual(nextLiveSessionViewStage("active", { remainingSeconds: 0 }), "ended");
  assert.equal(liveSessionOutcome("ACTIVE", "IN_PROGRESS"), null);
});

test("only a persisted completed appointment and ended session render as complete", () => {
  assert.equal(liveSessionOutcome("ENDED", "COMPLETED"), "COMPLETED");
  assert.equal(liveSessionOutcome("ENDED", "TECHNICAL_FAILURE"), "FAILED");
  assert.equal(liveSessionOutcome("TERMINATED", "TECHNICAL_FAILURE"), "FAILED");
  assert.equal(liveSessionOutcome("CANCELLED", "CANCELLED_BY_FACILITY"), "CANCELLED");
  assert.equal(nextLiveSessionViewStage("confirming", { persistedOutcome: "COMPLETED" }), "ended");
  assert.equal(nextLiveSessionViewStage("confirming", { persistedOutcome: null }), "confirming");
});

test("visitor and facility views use authoritative per-visit participant names", () => {
  const participants = { visitorName: "Maya Santoso", prisonerName: "Arif Hidayat" };
  assert.equal(remoteSessionPerson("VISITOR", participants), "Arif Hidayat");
  assert.equal(remoteSessionPerson("FACILITY", participants), "Maya Santoso");
  assert.equal(remoteSessionPerson("VISITOR", { visitorName: "Dewi Putri", prisonerName: "Bima Saputra" }), "Bima Saputra");
});

test("a disconnected video transport is treated as reconnecting unless scheduled time has ended", () => {
  assert.equal(nextLiveSessionViewStage("active", { connectionDisconnected: true }), "reconnecting");
  assert.equal(nextLiveSessionViewStage("active", { connectionDisconnected: true, scheduledTimeEnded: true }), "confirming");
  assert.equal(nextLiveSessionViewStage("left", { connectionDisconnected: true }), "left");
  assert.equal(nextLiveSessionViewStage("ended", { connectionDisconnected: true }), "ended");
});
