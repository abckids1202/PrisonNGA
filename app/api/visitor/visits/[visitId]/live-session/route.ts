import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { getVisitorSession, toSessionPayload } from "@/lib/server/video/session";
import { createLiveKitProvider, getVideoConfig } from "@/lib/server/video/provider";
import { getD1 } from "@/db/runtime";
import { enforceRateLimit } from "@/lib/server/rate-limit";

type RouteContext = { params: Promise<{ visitId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const { visitId } = await context.params;
    const session = await getVisitorSession(visitId, true);
    const config = await getVideoConfig();
    return securityResponse({ session: toSessionPayload(session), provider: { configured: config.configured, provider: config.provider } }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const { visitId } = await context.params;
    const session = await getVisitorSession(visitId);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-live-token:${session.visitor_user_id}:${visitId}`, limit: 12, windowSeconds: 60 * 10 });
    const config = await getVideoConfig();
    if (!config.configured) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const provider = await createLiveKitProvider();
    const token = await provider.createParticipantToken({ roomName: session.provider_room_name, identity: `visitor:${session.visitor_user_id}`, name: session.visitor_name, role: "VISITOR" });
    return securityResponse({ token, serverUrl: config.url, session: toSessionPayload(session), participantRole: "VISITOR", expiresInSeconds: 600 }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
