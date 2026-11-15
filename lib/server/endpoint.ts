export function isSecureHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function isSecureEndpoint(value: string, options: { allowLocalHttp?: boolean } = {}): boolean {
  if (isSecureHttpsEndpoint(value)) return true;
  if (!options.allowLocalHttp) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Payment credentials may only be sent to Xendit's documented API hosts in
 * staging/production. Development keeps the HTTPS test-host escape hatch so
 * adapter tests never need real provider credentials.
 */
export function isAllowedXenditApiEndpoint(value: string, environment: string): boolean {
  if (!isSecureEndpoint(value, { allowLocalHttp: environment === "development" })) return false;
  if (environment === "development") return true;
  try {
    const url = new URL(value);
    return ["api.xendit.co", "api-staging.xendit.co"].includes(url.hostname.toLowerCase())
      && !url.port && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}
