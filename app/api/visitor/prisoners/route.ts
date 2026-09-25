import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const facilityId = new URL(request.url).searchParams.get("facilityId")?.trim() || "";
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT p.id, p.facility_id, f.name AS facility_name, p.prisoner_number, p.display_name, p.status, p.visitation_status, vr.id AS relationship_id, COALESCE(vr.status, 'NOT_CONNECTED') AS relationship_status
      FROM prisoners p INNER JOIN facilities f ON f.id = p.facility_id INNER JOIN visit_policies vp ON vp.facility_id = p.facility_id LEFT JOIN visitor_relationships vr ON vr.prisoner_id = p.id AND vr.facility_id = p.facility_id AND vr.visitor_user_id = ?
      WHERE f.current_state = 'NORMAL_OPERATIONS' AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED' ${facilityId ? "AND p.facility_id = ?" : ""} ORDER BY p.display_name ASC LIMIT 200`).bind(...(facilityId ? [visitor.userId, facilityId] : [visitor.userId])).all();
    if (facilityId && !(await d1.prepare("SELECT id FROM facilities WHERE id = ?").bind(facilityId).first())) throw new SecurityError("FACILITY_NOT_FOUND", 404);
    return securityResponse({ prisoners: result.results, facilityId: facilityId || null }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
