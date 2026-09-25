import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff and provider joins preserve facility integrity", async () => {
  const controlAppointments = await readFile(new URL("../lib/server/control-appointments.ts", import.meta.url), "utf8");
  const controlAppointmentRoute = await readFile(new URL("../app/api/control/appointments/route.ts", import.meta.url), "utf8");
  const appointmentDecisions = await readFile(new URL("../lib/server/appointment-decisions.ts", import.meta.url), "utf8");
  const waitingRoom = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  const verification = await readFile(new URL("../app/api/control/verification/route.ts", import.meta.url), "utf8");
  const evidence = await readFile(new URL("../app/api/control/verification/evidence/[documentId]/route.ts", import.meta.url), "utf8");
  const liveKit = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");

  assert.match(controlAppointments, /p\.id = a\.prisoner_id AND p\.facility_id = a\.facility_id/);
  assert.match(controlAppointmentRoute, /p\.id = a\.prisoner_id AND p\.facility_id = a\.facility_id/);
  assert.match(appointmentDecisions, /p\.id = a\.prisoner_id AND p\.facility_id = a\.facility_id/);
  assert.match(waitingRoom, /p\.id = a\.prisoner_id AND p\.facility_id = a\.facility_id/);
  assert.match(verification, /vr\.id = vc\.relationship_id AND vr\.facility_id = vc\.facility_id/);
  assert.match(verification, /p\.id = vr\.prisoner_id AND p\.facility_id = vr\.facility_id/);
  assert.match(evidence, /vc\.id = ed\.verification_case_id AND vc\.facility_id = ed\.facility_id/);
  assert.match(liveKit, /a\.id = vs\.appointment_id AND a\.facility_id = vs\.facility_id/);
});
