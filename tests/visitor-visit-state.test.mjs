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

