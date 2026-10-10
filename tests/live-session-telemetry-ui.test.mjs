import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Live Sessions exposes persisted participant connectivity without claiming telemetry is unavailable", async () => {
  const source = await readFile(new URL("../app/features/live-session/LiveSessionsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /PARTICIPANT TELEMETRY/);
  assert.match(source, /selected\.participants\.map\(\(participant\)/);
  assert.match(source, /participantLabel\(participant\.participant_role\)/);
  assert.match(source, /participant\.status\.replaceAll\("_", " "\)/);
  assert.match(source, /Media-quality metrics are not supplied by the current provider webhook/);
  assert.doesNotMatch(source, /Participant connectivity and media-quality telemetry are not yet exposed in this workspace/);
});
