import assert from "node:assert/strict";
import test from "node:test";
import { controlNavigationUrl, parseControlNavigation } from "../lib/control-navigation.ts";

test("control navigation restores valid operations deep links", () => {
  assert.deepEqual(parseControlNavigation("?workspace=operations&page=Waiting%20Room"), { mode: "operations", page: "Waiting Room" });
});

test("control navigation restores valid management deep links", () => {
  assert.deepEqual(parseControlNavigation("?workspace=management&page=Compliance"), { mode: "management", page: "Compliance" });
});

test("control navigation rejects invalid workspace pages to safe defaults", () => {
  assert.deepEqual(parseControlNavigation("?workspace=management&page=Waiting%20Room"), { mode: "management", page: "People" });
  assert.deepEqual(parseControlNavigation("?workspace=unknown&page=Finance"), { mode: "operations", page: "Command Center" });
});

test("control navigation produces encoded deep-link URLs", () => {
  assert.equal(controlNavigationUrl("operations", "Waiting Room"), "/?workspace=operations&page=Waiting%20Room");
});
