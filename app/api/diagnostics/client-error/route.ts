import { getD1 } from "../../../../db/runtime";
import { operationalLog } from "../../../../lib/server/observability";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { readTextBodyWithinLimit } from "../../../../lib/server/request-body";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const SURFACES = new Set(["root", "global", "control", "visitor"]);

function bounded(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `client-error:${context.ipAddress || "unknown"}`, limit: 20, windowSeconds: 5 * 60 });
    const rawBody = await readTextBodyWithinLimit(request, 4 * 1024);
    let input: unknown;
    try { input = JSON.parse(rawBody); } catch { throw new SecurityError("CLIENT_ERROR_INVALID", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityError("CLIENT_ERROR_INVALID", 400);
    const body = input as Record<string, unknown>;
    const surface = bounded(body.surface, 16);
    const digest = bounded(body.digest, 256);
    const pathname = bounded(body.pathname, 200);
    if (!SURFACES.has(surface) || !/^[A-Za-z0-9._:-]{1,256}$/.test(digest) || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,199}$/.test(pathname)) {
      throw new SecurityError("CLIENT_ERROR_INVALID", 400);
    }
    operationalLog("error", {
      event: "CLIENT_ERROR_BOUNDARY",
      requestId: context.requestId,
      correlationId: context.requestId,
      surface,
      digest,
      pathname,
    });
    return securityResponse({ accepted: true }, 202, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
