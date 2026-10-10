import assert from "node:assert/strict";
import test from "node:test";
import { mapBackendAppointment } from "../app/features/control/model.ts";

const baseRow = {
  id: "appointment-1",
  visitor_name: "A. Visitor",
  prisoner_name: "P. Resident",
  requested_start: "2026-10-10T09:00:00+07:00",
  requested_end: "2026-10-10T09:30:00+07:00",
  timezone: "Asia/Jakarta",
  status: "APPROVED",
};

test("appointment mapping formats a valid persisted window", () => {
  const appointment = mapBackendAppointment(baseRow);
  assert.equal(appointment.date, "10 Oct 2026");
  assert.equal(appointment.time, "09:00–09:30");
  assert.equal(appointment.status, "Approved");
});

test("appointment mapping fails closed for malformed time data", () => {
  const appointment = mapBackendAppointment({
    ...baseRow,
    requested_start: "not-a-date",
    requested_end: "also-not-a-date",
    timezone: "Not/AZone",
  });
  assert.equal(appointment.date, "Date unavailable");
  assert.equal(appointment.time, "Time unavailable");
  assert.equal(appointment.status, "Approved");
});
