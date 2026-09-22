import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state
      FROM facilities f INNER JOIN visit_policies vp ON vp.facility_id = f.id
      WHERE f.current_state = 'NORMAL_OPERATIONS' ORDER BY f.name`).all();
    return securityResponse({ facilities: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
