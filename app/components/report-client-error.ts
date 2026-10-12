export type ClientErrorSurface = "root" | "global" | "control" | "visitor";

/**
 * Sends only a bounded, privacy-safe boundary signal. The server endpoint
 * rate-limits and redacts the event before it reaches platform logs.
 */
export function reportClientError(surface: ClientErrorSurface, digest?: string): void {
  if (typeof window === "undefined") return;
  const safeDigest = typeof digest === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(digest) ? digest : "unknown";
  const pathname = window.location.pathname.slice(0, 200) || "/";
  try {
    void fetch("/api/diagnostics/client-error", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface, digest: safeDigest, pathname }),
    });
  } catch {
    // Error reporting must never create a second user-facing failure.
  }
}
