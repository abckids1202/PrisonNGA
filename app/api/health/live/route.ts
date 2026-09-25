import { securityResponse } from "../../../../lib/server/security";

/** Public liveness probe. Detailed readiness remains staff-authorized. */
export async function GET() {
  return securityResponse({ status: "ok" }, 200);
}
