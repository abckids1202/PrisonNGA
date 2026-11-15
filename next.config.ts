import type { NextConfig } from "next";

function configuredWorkerOrigin(): string | null {
  const raw = process.env.WORKER_API_ORIGIN?.trim() || "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function liveKitConnectSources(): string {
  const sources = new Set(["https://*.livekit.cloud", "wss://*.livekit.cloud", "https://*.livekit.io", "wss://*.livekit.io"]);
  const raw = process.env.LIVEKIT_URL?.trim() || "";
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "wss:") {
      sources.add(`${url.protocol}//${url.host}`);
      sources.add(`${url.protocol === "https:" ? "wss:" : "https:"}//${url.host}`);
    }
  } catch {
    // Keep the safe hosted allow-list; deployment readiness reports malformed configuration.
  }
  return [...sources].join(" ");
}

function frontendSecurityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' ${liveKitConnectSources()}` },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-XSS-Protection", value: "0" },
  ];
  if ((process.env.SECUREVISIT_ENVIRONMENT || "development").trim().toLowerCase() !== "development" && process.env.VERCEL !== "0") {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}

const nextConfig: NextConfig = {
  // Vercel hosts the browser shell, while the Cloudflare Worker remains the
  // authoritative API. Rewriting instead of redirecting keeps the browser's
  // cookie/CSRF boundary same-origin. Local development has no rewrite so it
  // continues to use the in-process Worker binding.
  async rewrites() {
    const workerOrigin = configuredWorkerOrigin();
    return workerOrigin ? [{ source: "/api/:path*", destination: `${workerOrigin}/api/:path*` }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: frontendSecurityHeaders() }];
  },
};

export default nextConfig;
