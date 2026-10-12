import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("critical staff mutations use deterministic entity/version idempotency keys", async () => {
  const shell = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const waiting = await readFile(new URL("../app/features/control/WaitingRoomPage.tsx", import.meta.url), "utf8");
  const resources = await readFile(new URL("../app/features/resources/ResourcesPage.tsx", import.meta.url), "utf8");
  const people = await readFile(new URL("../app/features/management/PeoplePage.tsx", import.meta.url), "utf8");
  const finance = await readFile(new URL("../app/features/management/FinancePage.tsx", import.meta.url), "utf8");
  const administration = await readFile(new URL("../app/features/management/AdministrationPage.tsx", import.meta.url), "utf8");
  const notifications = await readFile(new URL("../app/features/management/NotificationOperationsPanel.tsx", import.meta.url), "utf8");
  const appointmentTypes = await readFile(new URL("../app/components/AppointmentTypesPanel.tsx", import.meta.url), "utf8");
  const accessReview = await readFile(new URL("../app/components/AccessReviewPanel.tsx", import.meta.url), "utf8");

  assert.match(shell, /facility-state:\$\{nextState\}:\$\{facilityVersion\}`/);
  assert.match(shell, /appointment-decision-\$\{id\}-\$\{command\}-\$\{appointment\.version\}`/);
  assert.match(shell, /resource-reassign:\$\{input\.appointmentId\}:\$\{input\.sourceResourceId\}:\$\{input\.expectedSourceVersion\}:\$\{input\.targetResourceId\}:\$\{input\.expectedTargetVersion\}:\$\{input\.expectedWaitingVersion\}`/);
  assert.match(waiting, /waiting-room-\$\{record\.id\}-\$\{record\.backendVersion\}-\$\{command\}`/);
  assert.match(resources, /resource-status-\$\{resource\.id\}-\$\{resource\.version\}-\$\{nextStatus\}`/);
  assert.match(people, /verification-\$\{selected\.id\}-\$\{selected\.version\}-\$\{status\}`/);
  assert.match(finance, /payment-event-replay-\$\{event\.id\}`/);
  assert.match(finance, /finance-refund-\$\{refundPayment\.id\}`/);
  assert.match(administration, /staff-status-\$\{record\.id\}-\$\{record\.version\}-\$\{next\}`/);
  assert.match(notifications, /outbox-replay-\$\{event\.id\}`/);
  assert.match(appointmentTypes, /appointment-type-\$\{currentType\.id\}-\$\{currentType\.version\}`/);
  assert.match(accessReview, /staff-session-revoke-\$\{session\.id\}`/);
});
