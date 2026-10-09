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
  const now = new Date().toISOString();
  try {
    await database.prepare(`INSERT INTO security_events
      (id, facility_id, event_type, severity, request_id, metadata, created_at)
      VALUES (?, ?, 'WAITING_ROOM_RECONCILIATION_REQUIRED', 'CRITICAL', ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        input.facilityId,
        input.requestId,
        JSON.stringify({
          appointmentId: input.appointmentId,
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
      event: "WAITING_ROOM_RECONCILIATION_RECORD_FAILED",
      facilityId: input.facilityId,
      requestId: input.requestId,
      correlationId: input.correlationId || null,
      appointmentId: input.appointmentId,
      operation: input.operation,
      error,
    });
  }
}
