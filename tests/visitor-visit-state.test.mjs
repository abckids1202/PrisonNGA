import assert from "node:assert/strict";
import test from "node:test";
import { getVisitorVisitViewState } from "../lib/visitor/visit-details-state.ts";

const input = { status: "APPROVED", session_status: null, waiting_room_state: null };

test("visit details only presents states supported by the persisted workflow", () => {
  const cases = [
    [{ status: "SUBMITTED" }, "review"],
    [{ status: "UNDER_REVIEW" }, "review"],
    [{ status: "APPROVED" }, "approved"],
    [{ status: "WAITING" }, "waiting"],
    [{ status: "WAITING", session_status: "CONNECTING" }, "ready"],
    [{ status: "IN_PROGRESS", session_status: "ACTIVE" }, "live"],
    [{ status: "IN_PROGRESS", session_status: "RECONNECTING" }, "live"],
    [{ status: "COMPLETED", session_status: "ENDED" }, "completed"],
    [{ status: "CANCELLED_BY_VISITOR" }, "cancelled"],
    [{ status: "CANCELLED_BY_FACILITY" }, "cancelled"],
    [{ status: "REJECTED" }, "rejected"],
    [{ status: "TECHNICAL_FAILURE", session_status: "TERMINATED" }, "issue"],
    [{ status: "WAITING", waiting_room_state: "TECHNICAL_ISSUE" }, "issue"],
    [{ status: "UNKNOWN_LEGACY_STATUS" }, "issue"],
  ];
  for (const [change, expected] of cases) {
    assert.equal(getVisitorVisitViewState({ ...input, ...change }), expected);
  }
});

test("a terminated or failed session is never described as a completed visit", () => {
  assert.equal(getVisitorVisitViewState({ status: "TECHNICAL_FAILURE", session_status: "TERMINATED", waiting_room_state: null }), "issue");
  assert.equal(getVisitorVisitViewState({ status: "IN_PROGRESS", session_status: "FAILED", waiting_room_state: null }), "issue");
});

test("terminal appointment state wins over stale session state", () => {
  assert.equal(getVisitorVisitViewState({ status: "CANCELLED_BY_VISITOR", session_status: "CONNECTING", waiting_room_state: null }), "cancelled");
  assert.equal(getVisitorVisitViewState({ status: "COMPLETED", session_status: "ACTIVE", waiting_room_state: null }), "issue");
  assert.equal(getVisitorVisitViewState({ status: "COMPLETED", session_status: "ENDED", waiting_room_state: null }), "completed");
});

test("visitor details keeps waiting-room entry available when the prisoner arrives first", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/visitor/VisitDetailsClient.tsx", import.meta.url), "utf8");
  assert.match(source, /visitorAlreadyWaiting = appointment\.visitor_presence === "present"/);
  assert.match(source, /\["APPROVED", "WAITING"\]\.includes\(appointment\.status\)/);
  assert.match(source, /waiting_room_version !== null/);
  assert.match(source, /waitingRoomOpensLater/);
});

test("visitor visit details exposes an idempotent cancellation confirmation", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/visitor/VisitDetailsClient.tsx", import.meta.url), "utf8");
  assert.match(source, /action: "cancel", expectedVersion: appointment\.version/);
  assert.match(source, /securevisit:cancel-appointment:/);
  assert.match(source, /Cancelled by visitor/);
  assert.match(source, /The cancellation is recorded in your visit history/);
});

test("visitor visit list cancellation reuses its idempotency key for retries", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const cancelKeys = useRef<Record<string, string>>\(\{\}\)/);
  assert.match(source, /cancelKeys\.current\[key\] \|\|= crypto\.randomUUID\(\)/);
  assert.match(source, /"Idempotency-Key": cancelKeys\.current\[key\]/);
});

