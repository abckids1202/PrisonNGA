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

const nextConfig: NextConfig = {
  // Vercel hosts the browser shell, while the Cloudflare Worker remains the
  // authoritative API. Rewriting instead of redirecting keeps the browser's
  // cookie/CSRF boundary same-origin. Local development has no rewrite so it
  // continues to use the in-process Worker binding.
  async rewrites() {
    const workerOrigin = configuredWorkerOrigin();
    return workerOrigin ? [{ source: "/api/:path*", destination: `${workerOrigin}/api/:path*` }] : [];
  },
};

export default nextConfig;
