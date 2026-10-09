import { operationalLog } from "./observability";

type ReconciliationDatabase = Pick<D1Database, "prepare">;

export function notificationDeadLetterStatement(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    outboxEventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string | null;
    attempt: number;
    error: string;
    requestId: string;
    correlationId: string;
    now: string;
  },
): D1PreparedStatement {
  return database.prepare(`INSERT OR IGNORE INTO security_events
    (id, facility_id, event_type, severity, request_id, metadata, created_at)
    SELECT ?, ?, 'NOTIFICATION_OUTBOX_DEAD_LETTER', 'CRITICAL', ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM outbox_events
      WHERE id = ? AND facility_id = ? AND status = 'DEAD_LETTER' AND attempt_count >= 5
    )`).bind(
    `notification-dead-letter:${input.outboxEventId}`,
    input.facilityId,
    input.requestId,
    JSON.stringify({
      entityType: "outbox_event",
      entityId: input.outboxEventId,
      operation: "NOTIFICATION_DELIVERY",
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      attempt: input.attempt,
      error: input.error,
      correlationId: input.correlationId,
      requiresStaffReview: true,
    }),
    input.now,
    input.outboxEventId,
    input.facilityId,
  );
}

export function paymentDeadLetterStatement(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    paymentEventId: string;
    provider: string;
    eventKey: string;
    eventType: string;
    attempt: number;
    error: string;
    requestId: string;
    now: string;
  },
): D1PreparedStatement {
  return database.prepare(`INSERT OR IGNORE INTO security_events
    (id, facility_id, event_type, severity, request_id, metadata, created_at)
    SELECT ?, ?, 'PAYMENT_PROVIDER_EVENT_DEAD_LETTER', 'CRITICAL', ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM payment_provider_events
      WHERE id = ? AND facility_id = ? AND status = 'DEAD_LETTER' AND attempt_count >= 8
    )`).bind(
    `payment-provider-dead-letter:${input.paymentEventId}`,
    input.facilityId,
    input.requestId,
    JSON.stringify({
      entityType: "payment_provider_event",
      entityId: input.paymentEventId,
      operation: "PAYMENT_RECONCILIATION",
      provider: input.provider,
      eventKey: input.eventKey,
      eventType: input.eventType,
      attempt: input.attempt,
      error: input.error,
      requiresStaffReview: true,
    }),
    input.now,
    input.paymentEventId,
    input.facilityId,
  );
}

export function liveSessionProviderFailureStatement(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    sessionId: string;
    appointmentId: string;
    visitorUserId: string;
    providerRoomName: string;
    reason: string;
    requestId: string;
    correlationId: string;
    now: string;
  },
): D1PreparedStatement {
  return database.prepare(`INSERT OR IGNORE INTO security_events
    (id, facility_id, event_type, severity, request_id, metadata, created_at)
    VALUES (?, ?, 'LIVE_SESSION_PROVIDER_CLOSE_FAILED', 'CRITICAL', ?, ?, ?)`).bind(
    `live-session-provider-close-failed:${input.sessionId}`,
    input.facilityId,
    input.requestId,
    JSON.stringify({
      entityType: "visit_session",
      entityId: input.sessionId,
      operation: "LIVE_SESSION_PROVIDER_CLOSE",
      appointmentId: input.appointmentId,
      visitorUserId: input.visitorUserId,
      providerRoomName: input.providerRoomName,
      reason: input.reason,
      correlationId: input.correlationId,
      retryable: true,
      requiresStaffReview: true,
    }),
    input.now,
  );
}

export function liveSessionFinalizationBlockedStatement(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    sessionId: string;
    appointmentId: string;
    visitorUserId: string;
    providerRoomName: string;
    reason: string;
    requestId: string;
    correlationId: string;
    now: string;
  },
): D1PreparedStatement {
  return database.prepare(`INSERT OR IGNORE INTO security_events
    (id, facility_id, event_type, severity, request_id, metadata, created_at)
    VALUES (?, ?, 'LIVE_SESSION_FINALIZATION_BLOCKED', 'CRITICAL', ?, ?, ?)`).bind(
    `live-session-finalization-blocked:${input.sessionId}`,
    input.facilityId,
    input.requestId,
    JSON.stringify({
      entityType: "visit_session",
      entityId: input.sessionId,
      operation: "LIVE_SESSION_FINALIZATION",
      appointmentId: input.appointmentId,
      visitorUserId: input.visitorUserId,
      providerRoomName: input.providerRoomName,
      reason: input.reason,
      correlationId: input.correlationId,
      retryable: true,
      creditSettlementBlocked: true,
      requiresStaffReview: true,
    }),
    input.now,
  );
}

/**
 * Record a durable operational alarm when a compensating workflow write could
 * not restore its previous snapshot. The primary request must still fail
 * closed; this event gives facility operations a searchable recovery signal.
 */
export async function recordWaitingRoomReconciliationRequired(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    appointmentId: string;
    operation: string;
    requestId: string;
    correlationId?: string;
    expectedVersion: number;
  },
): Promise<void> {
  return recordReconciliationRequired(database, {
    facilityId: input.facilityId,
    entityId: input.appointmentId,
    entityType: "appointment",
    operation: input.operation,
    requestId: input.requestId,
    correlationId: input.correlationId,
    expectedVersion: input.expectedVersion,
    eventType: "WAITING_ROOM_RECONCILIATION_REQUIRED",
    failureLogEvent: "WAITING_ROOM_RECONCILIATION_RECORD_FAILED",
  });
}

export async function recordResourceReconciliationRequired(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    resourceId: string;
    operation: string;
    requestId: string;
    correlationId?: string;
    expectedVersion: number;
  },
): Promise<void> {
  return recordReconciliationRequired(database, {
    facilityId: input.facilityId,
    entityId: input.resourceId,
    entityType: "resource",
    operation: input.operation,
    requestId: input.requestId,
    correlationId: input.correlationId,
    expectedVersion: input.expectedVersion,
    eventType: "RESOURCE_RECONCILIATION_REQUIRED",
    failureLogEvent: "RESOURCE_RECONCILIATION_RECORD_FAILED",
  });
}

async function recordReconciliationRequired(
  database: ReconciliationDatabase,
  input: {
    facilityId: string;
    entityId: string;
    entityType: string;
    operation: string;
    requestId: string;
    correlationId?: string;
    expectedVersion: number;
    eventType: string;
    failureLogEvent: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await database.prepare(`INSERT INTO security_events
      (id, facility_id, event_type, severity, request_id, metadata, created_at)
      VALUES (?, ?, ?, 'CRITICAL', ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        input.facilityId,
        input.eventType,
        input.requestId,
        JSON.stringify({
          entityType: input.entityType,
          entityId: input.entityId,
          operation: input.operation,
          correlationId: input.correlationId || null,
          expectedVersion: input.expectedVersion,
          requiresStaffReview: true,
        }),
        now,
      )
      .run();
  } catch (error) {
    // If D1 itself is unavailable, preserve a redacted runtime signal for the
    // platform alerting pipeline. Never include request bodies or credentials.
    operationalLog("error", {
      event: input.failureLogEvent,
      facilityId: input.facilityId,
      requestId: input.requestId,
      correlationId: input.correlationId || null,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      error,
    });
  }
}
