import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("staff.manage");
    const d1 = await getD1();
    const now = new Date().toISOString();
    const result = await d1.prepare(`SELECT
        u.id,
        u.email,
        u.display_name,
        u.status,
        u.last_login_at,
        u.version,
        sp.employee_reference,
        sp.job_title,
        sp.department,
        GROUP_CONCAT(DISTINCT r.name) AS roles,
        (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_session_count
      FROM users u
      INNER JOIN staff_profiles sp ON sp.user_id = u.id
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.facility_id = sp.facility_id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE sp.facility_id = ? AND u.user_type = 'STAFF'
      GROUP BY u.id
      ORDER BY CASE u.status WHEN 'ACTIVE' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END, u.display_name`).bind(now, authorization.facilityId).all();

    const staff = result.results;
    const summary = staff.reduce<{ total: number; active: number; suspended: number; disabled: number; activeSessions: number }>((counts, member) => {
      const status = String(member.status);
      if (status === "ACTIVE") counts.active += 1;
      else if (status === "SUSPENDED") counts.suspended += 1;
      else if (status === "DISABLED") counts.disabled += 1;
      counts.activeSessions += Number(member.active_session_count || 0);
      return counts;
    }, { total: 0, active: 0, suspended: 0, disabled: 0, activeSessions: 0 });
    summary.total = staff.length;

    return securityResponse({ generatedAt: now, facilityId: authorization.facilityId, summary, staff }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
