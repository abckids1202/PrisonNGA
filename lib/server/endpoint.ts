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
