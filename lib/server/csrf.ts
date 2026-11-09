const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FEDERATION_CALLBACKS = new Set([
  "/api/auth/staff/saml/callback",
  "/api/webhooks/livekit",
  "/api/webhooks/payments",
  "/api/webhooks/xendit",
  "/api/webhooks/notifications/status",
  "/api/webhooks/evidence-scan",
]);

function hasCookie(cookieHeader: string | null, name: string): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

export function isCookieAuthenticatedMutation(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") || FEDERATION_CALLBACKS.has(url.pathname)) return false;
  const cookie = request.headers.get("cookie");
  return hasCookie(cookie, "securevisit_session") || hasCookie(cookie, "securevisit_staff_session");
}

export function isSameOriginMutation(request: Request, configuredPublicOrigin?: string): boolean {
  if (!isCookieAuthenticatedMutation(request)) return true;
  const url = new URL(request.url);
  const allowedOrigins = new Set([url.origin]);
  if (configuredPublicOrigin) {
    try {
      const publicUrl = new URL(configuredPublicOrigin);
      if (publicUrl.protocol === "https:" || (publicUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname))) {
        allowedOrigins.add(publicUrl.origin);
      }
    } catch {
      // Invalid deployment configuration is handled by the environment
      // validator; it must never expand the CSRF allow-list.
    }
  }
  const origin = request.headers.get("origin")?.trim();
  if (origin && origin !== "null") return allowedOrigins.has(origin);
  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try { return allowedOrigins.has(new URL(referer).origin); }
    catch { return false; }
  }
  return false;
}
