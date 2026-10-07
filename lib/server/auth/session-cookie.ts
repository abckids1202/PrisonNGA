export type SessionCookieName = "securevisit_session" | "securevisit_staff_session";

export function buildSessionCookie(name: SessionCookieName, token: string, maxAgeSeconds: number, secure: boolean): string {
  if (!token || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) throw new Error("SESSION_COOKIE_INPUT_INVALID");
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(name: SessionCookieName, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
