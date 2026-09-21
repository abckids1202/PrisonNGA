import { getRequestContext, securityErrorResponse, securityResponse } from "../../../../../lib/server/security";
import { getStaffFederationConfig } from "../../../../../lib/server/auth/federation";

export async function GET() {
  const context = await getRequestContext();
  try { return securityResponse({ staffFederation: await getStaffFederationConfig() }, 200, context.requestId); }
  catch (error) { return securityErrorResponse(error, context.requestId); }
}
