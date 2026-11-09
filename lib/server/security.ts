import { cookies, headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { getD1 } from "../../db/runtime";
import { authSessions, permissions, rolePermissions, roles, staffProfiles, userRoles, users } from "../../db/schema";
import { consumeStepUpNonce, hashStepUpNonce, hashStepUpPayload, verifyStepUpAssertion, type StepUpBinding } from "./step-up";

export type WorkspaceIdentity = { externalId: string; email: string; displayName: string };
export type RequestContext = { requestId: string; ipAddress: string | null; userAgent: string | null };
export type AuthorizationContext = { userId: string; facilityId: string; roles: string[]; permissions: string[]; displayName: string };
export type OrganizationAuthorizationContext = { userId: string; organizationId: string; facilityId: string; roles: string[]; permissions: string[]; displayName: string };
export type VisitorAuthorizationContext = { userId: string; email: string | null; phone: string | null; phoneVerifiedAt: string | null; displayName: string };

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

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
  const staffSession = await getStaffSessionIdentity();
  if (staffSession) return staffSession;
  // Workspace headers are supplied by the local desktop host and are useful
  // for development rendering only. Never treat them as an institutional
  // authentication mechanism in staging or production, where staff access
  // must come from a persisted OIDC/SAML session.
  if ((await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development") return null;
  return parseWorkspaceIdentity(await headers());
}

export async function getStaffSessionIdentity(): Promise<WorkspaceIdentity | null> {
  const sessionToken = (await cookies()).get("securevisit_staff_session")?.value;
  if (!sessionToken) return null;
  const salt = await getSecuritySalt();
  const tokenHash = await hashIdentifier(sessionToken, salt);
  const db = await getDb();
  const [sessionUser] = await db.select({ externalId: users.externalId, email: users.email, displayName: users.displayName, status: users.status, userType: users.userType, lastSeenAt: authSessions.lastSeenAt })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), eq(users.userType, "STAFF"), isNull(authSessions.revokedAt), sql`julianday(${authSessions.expiresAt}) > julianday(${new Date().toISOString()})`))
    .limit(1);
  if (!sessionUser || sessionUser.status !== "ACTIVE") return null;
  if (shouldTouchSession(sessionUser.lastSeenAt)) await db.update(authSessions).set({ lastSeenAt: new Date().toISOString() }).where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
  return { externalId: sessionUser.externalId, email: sessionUser.email || "", displayName: sessionUser.displayName };
}

export async function requireWorkspaceIdentity(): Promise<WorkspaceIdentity> {
  const identity = await getWorkspaceIdentity();
  if (!identity) throw new SecurityError("AUTHENTICATION_REQUIRED", 401);
  return identity;
}

export async function requireVisitorIdentity(): Promise<VisitorAuthorizationContext> {
  const sessionVisitor = await getVisitorSessionIdentity();
  if (sessionVisitor) return sessionVisitor;
  throw new SecurityError("AUTHENTICATION_REQUIRED", 401);
}

export async function getVisitorSessionIdentity(): Promise<VisitorAuthorizationContext | null> {
  const sessionToken = (await cookies()).get("securevisit_session")?.value;
  if (!sessionToken) return null;
  const salt = await getSecuritySalt();
  const tokenHash = await hashIdentifier(sessionToken, salt);
  const db = await getDb();
  const [sessionUser] = await db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt, displayName: users.displayName, userType: users.userType, status: users.status, lastSeenAt: authSessions.lastSeenAt })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), eq(users.userType, "VISITOR"), isNull(authSessions.revokedAt), sql`julianday(${authSessions.expiresAt}) > julianday(${new Date().toISOString()})`))
    .limit(1);
  if (!sessionUser || sessionUser.status !== "ACTIVE") return null;
  if (shouldTouchSession(sessionUser.lastSeenAt)) await db.update(authSessions).set({ lastSeenAt: new Date().toISOString() }).where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
  return { userId: sessionUser.id, email: sessionUser.emailVerifiedAt ? sessionUser.email : null, phone: sessionUser.phone, phoneVerifiedAt: sessionUser.phoneVerifiedAt, displayName: sessionUser.displayName };
}

function shouldTouchSession(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const parsed = Date.parse(lastSeenAt);
  return !Number.isFinite(parsed) || Date.now() - parsed >= SESSION_TOUCH_INTERVAL_MS;
}

async function resolveFacilityScope(d1: D1Database, userId: string, explicitFacilityId: string | undefined, selectedFacilityId: string, profileFacilityId: string | undefined): Promise<string> {
  if (explicitFacilityId) return explicitFacilityId;
  if (selectedFacilityId) {
    const selectedAssignment = await d1.prepare(`SELECT 1 AS active FROM staff_facility_assignments WHERE user_id = ? AND facility_id = ? AND status = 'ACTIVE'
      UNION ALL SELECT 1 AS active FROM staff_profiles
        WHERE user_id = ? AND facility_id = ?
          AND NOT EXISTS (SELECT 1 FROM staff_facility_assignments WHERE user_id = ?) LIMIT 1`).bind(userId, selectedFacilityId, userId, selectedFacilityId, userId).first<{ active: number }>();
    if (selectedAssignment) return selectedFacilityId;
  }
  if (profileFacilityId) {
    const legacyProfile = await d1.prepare(`SELECT 1 AS active FROM staff_profiles
      WHERE user_id = ? AND facility_id = ?
        AND NOT EXISTS (SELECT 1 FROM staff_facility_assignments WHERE user_id = ?)`).bind(userId, profileFacilityId, userId).first<{ active: number }>();
    if (legacyProfile) return profileFacilityId;
  }
  const fallback = await d1.prepare("SELECT facility_id FROM staff_facility_assignments WHERE user_id = ? AND status = 'ACTIVE' ORDER BY facility_id LIMIT 1").bind(userId).first<{ facility_id: string }>();
  return fallback?.facility_id || "";
}

export async function getRequestContext(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const suppliedRequestId = requestHeaders.get("x-request-id")?.trim() || "";
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  const cloudflareIp = requestHeaders.get("cf-connecting-ip")?.trim() || "";
  // In the Cloudflare deployment model this header is supplied by the edge.
  // Do not trust a client-provided X-Forwarded-For value in staging or
  // production: rotating that header would bypass IP-based abuse controls.
  // Local development keeps the fallback so browser tests and local reverse
  // proxies can still identify their requests.
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  const developmentForwardedIp = environment === "development"
    ? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || ""
    : "";
  return { requestId, ipAddress: cloudflareIp || developmentForwardedIp || null, userAgent: requestHeaders.get("user-agent") };
}

export async function requirePermission(permissionKey: string, facilityId?: string): Promise<AuthorizationContext> {
  const identity = await requireWorkspaceIdentity();
  const db = await getDb();
  const [user] = await db.select().from(users).where(and(eq(users.externalId, identity.externalId), eq(users.userType, "STAFF"))).limit(1);
  if (!user || user.status !== "ACTIVE") throw new SecurityError("ACCOUNT_NOT_PROVISIONED", 403);

  const [profile] = await db.select({ facilityId: staffProfiles.facilityId }).from(staffProfiles).where(eq(staffProfiles.userId, user.id)).limit(1);
  const d1 = await getD1();
  const selectedFacilityId = (await cookies()).get("securevisit_facility_context")?.value?.trim() || "";
  const requestedFacilityId = await resolveFacilityScope(d1, user.id, facilityId, selectedFacilityId, profile?.facilityId);
  if (!requestedFacilityId) throw new SecurityError("FACILITY_SCOPE_DENIED", 403);
  const assignment = await d1.prepare(`SELECT 1 AS active FROM staff_facility_assignments WHERE user_id = ? AND facility_id = ? AND status = 'ACTIVE'
    UNION ALL SELECT 1 AS active FROM staff_profiles
      WHERE user_id = ? AND facility_id = ?
        AND NOT EXISTS (SELECT 1 FROM staff_facility_assignments WHERE user_id = ?) LIMIT 1`).bind(user.id, requestedFacilityId, user.id, requestedFacilityId, user.id).first<{ active: number }>().catch(() => null);
  if (!assignment) throw new SecurityError("FACILITY_SCOPE_DENIED", 403);
  const scopedFacilityId = requestedFacilityId;

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

/** Authorize organization administration independently from facility roles. */
export async function requireOrganizationPermission(permissionKey: string): Promise<OrganizationAuthorizationContext> {
  const identity = await requireWorkspaceIdentity();
  const db = await getDb();
  const [user] = await db.select().from(users).where(and(eq(users.externalId, identity.externalId), eq(users.userType, "STAFF"))).limit(1);
  if (!user || user.status !== "ACTIVE") throw new SecurityError("ACCOUNT_NOT_PROVISIONED", 403);

  const [profile] = await db.select({ facilityId: staffProfiles.facilityId }).from(staffProfiles).where(eq(staffProfiles.userId, user.id)).limit(1);
  const d1 = await getD1();
  const selectedFacilityId = (await cookies()).get("securevisit_facility_context")?.value?.trim() || "";
  let facilityId = await resolveFacilityScope(d1, user.id, undefined, selectedFacilityId, profile?.facilityId);
  let organizationId: string | null = null;
  if (facilityId) {
    const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?").bind(facilityId).first<{ organization_id: string | null }>();
    organizationId = facility?.organization_id || null;
  }
  // Organization owners/administrators may intentionally have no facility
  // membership while retaining organization-wide administration. Resolve
  // that case from the organization role itself, but fail closed when the
  // account spans multiple organizations and no context was selected.
  if (!organizationId) {
    const organizationRows = await d1.prepare(`SELECT ora.organization_id, MIN(f.id) AS facility_id
      FROM organization_role_assignments ora
      INNER JOIN roles r ON r.id = ora.role_id
      INNER JOIN role_permissions rp ON rp.role_id = r.id
      INNER JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = ?
      LEFT JOIN facilities f ON f.organization_id = ora.organization_id AND f.status = 'ACTIVE'
      WHERE ora.user_id = ? AND ora.status = 'ACTIVE'
      GROUP BY ora.organization_id`).bind(permissionKey, user.id).all<{ organization_id: string; facility_id: string | null }>();
    if (organizationRows.results.length !== 1 || !organizationRows.results[0].facility_id) throw new SecurityError(organizationRows.results.length > 1 ? "ORGANIZATION_CONTEXT_REQUIRED" : "FACILITY_SCOPE_DENIED", 403);
    organizationId = organizationRows.results[0].organization_id;
    facilityId = organizationRows.results[0].facility_id;
  }
  const roles = await d1.prepare(`SELECT r.name AS role_name
    FROM organization_role_assignments ora
    INNER JOIN roles r ON r.id = ora.role_id
    INNER JOIN role_permissions rp ON rp.role_id = r.id
    INNER JOIN permissions p ON p.id = rp.permission_id
    WHERE ora.user_id = ? AND ora.organization_id = ? AND ora.status = 'ACTIVE'
      AND p.permission_key = ? LIMIT 25`).bind(user.id, organizationId, permissionKey).all<{ role_name: string }>();
  if (!roles.results.length) throw new SecurityError("PERMISSION_DENIED", 403);
  return { userId: user.id, organizationId, facilityId, roles: [...new Set(roles.results.map((row) => row.role_name))], permissions: [permissionKey], displayName: user.displayName };
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
  const response = securityResponse(securityError ? { error: securityError.code, requestId } : { error: "INTERNAL_ERROR", requestId }, securityError?.statusCode || 500, requestId);
  const retryAfter = securityError ? retryAfterSeconds(securityError) : null;
  if (retryAfter !== null) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function retryAfterSeconds(error: SecurityError): number | null {
  if (error.statusCode !== 429) return null;
  switch (error.code) {
    case "AUTH_RETRY_TOO_SOON": return 60;
    case "AUTH_CODE_LOCKED": return 600;
    case "AUTH_RATE_LIMITED": return 900;
    case "RATE_LIMITED": return 60;
    default: return 60;
  }
}

function liveKitConnectSources(): string {
  const sources = new Set(["https://*.livekit.cloud", "wss://*.livekit.cloud", "https://*.livekit.io", "wss://*.livekit.io"]);
  const configuredUrl = typeof process !== "undefined" && typeof process.env?.LIVEKIT_URL === "string" ? process.env.LIVEKIT_URL.trim() : "";
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "wss:") {
        const origin = `${parsed.protocol}//${parsed.host}`;
        sources.add(origin);
        sources.add(`${parsed.protocol === "https:" ? "wss:" : "https:"}//${parsed.host}`);
      }
    } catch {
      // Environment validation owns the configuration error; CSP stays on safe defaults.
    }
  }
  return [...sources].join(" ");
}

export function applySecurityHeaders(response: Response, requestId?: string): void {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Content-Security-Policy", `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${liveKitConnectSources()}`);
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
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
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  try {
    const { env } = await import("cloudflare:workers");
    const configuredSalt = (env as unknown as Record<string, unknown>).SECUREVISIT_HASH_SALT;
    if (typeof configuredSalt === "string" && configuredSalt.length >= 16) return configuredSalt;
  } catch {
    // The local test runner does not provide the Cloudflare runtime module.
  }
  if (environment === "development") return "local-development-only";
  throw new SecurityError("SECUREVISIT_HASH_SALT_NOT_CONFIGURED", 503);
}

export async function getRuntimeValue(key: string): Promise<string | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const value = (env as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  } catch {
    // The local test runner does not provide the Cloudflare runtime module.
  }
  if (typeof process !== "undefined" && typeof process.env?.[key] === "string") return process.env[key] || null;
  return null;
}

export async function requireStepUp(binding: StepUpBinding): Promise<void> {
  const assertion = (await headers()).get("x-securevisit-step-up")?.trim() || "";
  const secret = await getRuntimeValue("STAFF_STEP_UP_SECRET");
  if (!secret) throw new SecurityError("STEP_UP_REQUIRED", 403);
  const verified = await verifyStepUpAssertion(secret, assertion, binding);
  if (!verified) throw new SecurityError("STEP_UP_INVALID", 403);
  const nonceHash = await hashStepUpNonce(verified.nonce);
  const payloadHash = await hashStepUpPayload(binding.payload);
  const accepted = await consumeStepUpNonce(await getD1(), {
    nonceHash,
    actorUserId: binding.userId,
    purpose: binding.purpose,
    targetId: binding.targetId,
    payloadHash,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  });
  if (!accepted) throw new SecurityError("STEP_UP_REPLAYED", 403);
}

export async function requireActiveBreakGlass(
  d1: D1Database,
  input: { facilityId: string; userId: string; targetType: string; targetId: string },
): Promise<{ requestId: string; expiresAt: string; requestedBy: string }> {
  const now = new Date().toISOString();
  const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?").bind(input.facilityId).first<{ organization_id: string | null }>();
  if (!facility?.organization_id) throw new SecurityError("FACILITY_ORGANIZATION_NOT_CONFIGURED", 503);
  const request = await d1.prepare(`SELECT id, requested_by, expires_at
    FROM break_glass_requests
    WHERE organization_id = ? AND facility_id = ? AND target_type = ? AND target_id = ?
      AND status = 'APPROVED' AND expires_at > ?
      AND (requested_by = ? OR approved_by = ?)
    ORDER BY approved_at DESC LIMIT 1`)
    .bind(facility.organization_id, input.facilityId, input.targetType, input.targetId, now, input.userId, input.userId)
    .first<{ id: string; requested_by: string; expires_at: string }>();
  if (!request?.expires_at) throw new SecurityError("BREAK_GLASS_APPROVAL_REQUIRED", 403);
  return { requestId: request.id, expiresAt: request.expires_at, requestedBy: request.requested_by };
}
