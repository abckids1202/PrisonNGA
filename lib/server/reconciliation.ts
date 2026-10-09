import { operationalLog } from "./observability";

type ReconciliationDatabase = Pick<D1Database, "prepare">;

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
