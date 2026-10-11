/**
 * Returns a coarse, privacy-safe label for a session's user agent.
 *
 * We deliberately do not persist the raw user-agent string. The label is
 * useful for a visitor deciding whether to revoke a session, while remaining
 * much less identifying than a browser fingerprint.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const value = userAgent.toLowerCase();

  const browser = value.includes("edg/") ? "Edge"
    : value.includes("firefox/") ? "Firefox"
      : value.includes("opr/") || value.includes("opera") ? "Opera"
        : value.includes("chrome/") || value.includes("crios/") ? "Chrome"
          : value.includes("safari/") ? "Safari"
            : value.includes("trident/") || value.includes("msie") ? "Internet Explorer"
              : "Browser";

  const platform = value.includes("iphone") || value.includes("ipad") || value.includes("ipod") ? "iPhone or iPad"
    : value.includes("android") ? "Android"
      : value.includes("windows") ? "Windows"
        : value.includes("mac os") || value.includes("macintosh") ? "macOS"
          : value.includes("cros") ? "ChromeOS"
            : value.includes("linux") ? "Linux"
              : null;

  return platform ? `${browser} on ${platform}` : browser;
}
