import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "./lib/server/csrf";

/**
 * Browser-cookie CSRF boundary for the Worker API.
 *
 * The application currently runs same-origin in development and on the
 * Cloudflare Worker. When the browser frontend is deployed to Vercel, the
 * configured PUBLIC_APP_URL is also accepted so a Vercel rewrite can forward
 * the browser's Origin header to the authoritative Worker without weakening
 * the cookie boundary to arbitrary cross-origin requests.
 */
export function proxy(request: NextRequest): NextResponse {
  if (!isSameOriginMutation(request, process.env.PUBLIC_APP_URL?.trim())) {
    const response = NextResponse.json({ error: "CSRF_ORIGIN_MISMATCH" }, { status: 403 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
