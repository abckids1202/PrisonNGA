import { getRequestContext, securityResponse } from "../../../../lib/server/security";

/** Public liveness probe. Detailed readiness remains staff-authorized. */
export async function GET() {
  const context = await getRequestContext();
  return securityResponse({ status: "ok" }, 200, context.requestId);
}
