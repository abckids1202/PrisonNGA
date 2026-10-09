import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT se.id, se.user_id, se.facility_id, se.event_type, se.severity, se.request_id, se.ip_hash, se.user_agent_hash, se.metadata, se.created_at, i.id AS linked_incident_id
      FROM security_events se
      LEFT JOIN incidents i ON i.source_security_event_id = se.id AND i.facility_id = se.facility_id
      WHERE se.facility_id = ? ORDER BY se.created_at DESC LIMIT 100`).bind(authorization.facilityId).all();
    const events = result.results.map((event) => ({
      id: String(event.id), userId: event.user_id ? String(event.user_id) : null, facilityId: event.facility_id ? String(event.facility_id) : null,
      eventType: String(event.event_type), severity: String(event.severity), requestId: event.request_id ? String(event.request_id) : null,
      ipHash: event.ip_hash ? String(event.ip_hash) : null, userAgentHash: event.user_agent_hash ? String(event.user_agent_hash) : null,
      metadata: typeof event.metadata === "string" ? JSON.parse(event.metadata) as Record<string, unknown> : (event.metadata || {}),
      createdAt: String(event.created_at), linkedIncidentId: event.linked_incident_id ? String(event.linked_incident_id) : null,
    }));
    return securityResponse({ events, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
