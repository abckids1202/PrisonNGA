import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { permissions, rolePermissions, roles, staffProfiles, userRoles, users } from "../../db/schema";

export type WorkspaceIdentity = { externalId: string; email: string; displayName: string };
export type RequestContext = { requestId: string; ipAddress: string | null; userAgent: string | null };
export type AuthorizationContext = { userId: string; facilityId: string; roles: string[]; permissions: string[]; displayName: string };

const identityHeaders = {
  id: "oai-authenticated-user-id",
  email: "oai-authenticated-user-email",
  fullName: "oai-authenticated-user-full-name",
  fullNameEncoding: "oai-authenticated-user-full-name-encoding",
} as const;

export function parseWorkspaceIdentity(input: Headers): WorkspaceIdentity | null {
  const externalId = input.get(identityHeaders.id)?.trim();
  const email = input.get(identityHeaders.email)?.trim().toLowerCase();
  if (!externalId || !email) return null;
  const encodedName = input.get(identityHeaders.fullName);
  const fullName = encodedName && input.get(identityHeaders.fullNameEncoding) === "percent-encoded-utf-8" ? safeDecode(encodedName) : null;
  return { externalId, email, displayName: fullName?.trim() || email };
}

export async function getWorkspaceIdentity(): Promise<WorkspaceIdentity | null> {
  return parseWorkspaceIdentity(await headers());
}

export async function requireWorkspaceIdentity(): Promise<WorkspaceIdentity> {
  const identity = await getWorkspaceIdentity();
  if (!identity) throw new SecurityError("AUTHENTICATION_REQUIRED", 401);
  return identity;
}

export async function getRequestContext(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const suppliedRequestId = requestHeaders.get("x-request-id")?.trim() || "";
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  const forwardedFor = requestHeaders.get("cf-connecting-ip") || requestHeaders.get("x-forwarded-for");
  return { requestId, ipAddress: forwardedFor?.split(",")[0]?.trim() || null, userAgent: requestHeaders.get("user-agent") };
}

export async function requirePermission(permissionKey: string, facilityId?: string): Promise<AuthorizationContext> {
  const identity = await requireWorkspaceIdentity();
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.externalId, identity.externalId)).limit(1);
  if (!user || user.status !== "ACTIVE") throw new SecurityError("ACCOUNT_NOT_PROVISIONED", 403);

  const [profile] = await db.select({ facilityId: staffProfiles.facilityId }).from(staffProfiles).where(eq(staffProfiles.userId, user.id)).limit(1);
  const scopedFacilityId = facilityId || profile?.facilityId;
  if (!profile || !scopedFacilityId || profile.facilityId !== scopedFacilityId) throw new SecurityError("FACILITY_SCOPE_DENIED", 403);

  const rows = await db.select({ roleName: roles.name, permissionKey: permissions.permissionKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(userRoles.userId, user.id), eq(userRoles.facilityId, scopedFacilityId), eq(permissions.permissionKey, permissionKey)));
  if (!rows.length) throw new SecurityError("PERMISSION_DENIED", 403);

  return {
    userId: user.id,
    facilityId: scopedFacilityId,
    roles: [...new Set(rows.map((row) => row.roleName))],
    permissions: [permissionKey],
    displayName: user.displayName,
  };
}

export function assertReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 8) throw new SecurityError("REASON_REQUIRED", 400);
  return reason.trim().slice(0, 500);
}

export function securityResponse(body: unknown, status = 200, requestId?: string): Response {
  const response = Response.json(body, { status });
  applySecurityHeaders(response, requestId);
  return response;
}

export function securityErrorResponse(error: unknown, requestId?: string): Response {
  const securityError = error instanceof SecurityError ? error : null;
  return securityResponse(securityError ? { error: securityError.code, requestId } : { error: "INTERNAL_ERROR", requestId }, securityError?.statusCode || 500, requestId);
}

export function applySecurityHeaders(response: Response, requestId?: string): void {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "0");
  if (requestId) response.headers.set("X-Request-Id", requestId);
}

export class SecurityError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) { super(code); this.name = "SecurityError"; }
}

function safeDecode(value: string): string | null { try { return decodeURIComponent(value); } catch { return null; } }

export async function hashIdentifier(value: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getSecuritySalt(): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const configuredSalt = (env as unknown as Record<string, unknown>).SECUREVISIT_HASH_SALT;
    if (typeof configuredSalt === "string" && configuredSalt.length >= 16) return configuredSalt;
  } catch {
    // The local test runner does not provide the Cloudflare runtime module.
  }
  return "local-development-only";
}
