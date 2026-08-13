import { getD1 } from "../../db/runtime";

export type DomainEventInput = {
  actorUserId: string | null;
  actorRole: string | null;
  facilityId: string | null;
  actionType: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  requestId: string;
  correlationId?: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export async function appendAuditAndOutbox(input: DomainEventInput): Promise<{ correlationId: string }> {
  const d1 = await getD1();
  const correlationId = input.correlationId || crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await d1.batch([
    d1.prepare(`INSERT INTO audit_events
      (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(auditId, input.actorUserId, input.actorRole, input.facilityId, input.actionType, input.entityType, input.entityId, input.reason, input.oldValues ? JSON.stringify(input.oldValues) : null, input.newValues ? JSON.stringify(input.newValues) : null, correlationId, input.requestId, createdAt),
    d1.prepare(`INSERT INTO outbox_events
      (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(outboxId, input.eventType, input.entityType, input.entityId, input.facilityId, JSON.stringify(input.payload), correlationId, createdAt),
  ]);

  return { correlationId };
}
