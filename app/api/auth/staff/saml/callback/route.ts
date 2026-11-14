import { getD1 } from "../../../../../../db/runtime";
import { createSamlClient, getSamlConfig, getSamlMfaRequirement, hasRequiredSamlMfa, validateSamlResponse } from "../../../../../../lib/server/auth/saml";
import { hashFederationState } from "../../../../../../lib/server/auth/oidc";
import { applySecurityHeaders, getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";
import { buildSessionCookie } from "../../../../../../lib/server/auth/session-cookie";
import { enforceRateLimit } from "../../../../../../lib/server/rate-limit";
import { describeDevice } from "../../../../../../lib/server/auth/device-label";

async function staffCookie(token: string): Promise<string> { return buildSessionCookie("securevisit_staff_session", token, 28800, (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development"); }

async function recordFederationFailure(context: Awaited<ReturnType<typeof getRequestContext>>, error: unknown): Promise<void> {
  try {
    const d1 = await getD1();
    const salt = await getSecuritySalt();
    const now = new Date().toISOString();
    const errorCode = error instanceof SecurityError ? error.code : "FEDERATION_CALLBACK_FAILED";
    await d1.prepare("INSERT INTO security_events (id, event_type, severity, request_id, ip_hash, user_agent_hash, metadata, created_at) VALUES (?, 'STAFF_SAML_LOGIN_FAILED', 'WARNING', ?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      context.requestId,
      context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null,
      context.userAgent ? await hashIdentifier(context.userAgent, salt) : null,
      JSON.stringify({ provider: "SAML", errorCode }),
      now,
    ).run();
  } catch {
    // Authentication failure logging must never replace the safe auth response.
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const form = await request.formData();
    const samlResponse = form.get("SAMLResponse");
    const relayState = form.get("RelayState");
    if (typeof samlResponse !== "string" || samlResponse.length > 250_000 || typeof relayState !== "string" || !relayState) throw new SecurityError("STAFF_SAML_CALLBACK_INVALID", 400);
    const config = await getSamlConfig();
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `staff-federation:saml-callback:${context.ipAddress || "unknown"}`, limit: 30, windowSeconds: 15 * 60 });
    const stateHash = await hashFederationState(relayState);
    const client = await createSamlClient(config, d1, stateHash);
    const pending = await d1.prepare("SELECT id, expires_at, consumed_at, redirect_uri FROM auth_federation_states WHERE state_hash = ? AND provider = 'saml'").bind(stateHash).first<{ id: string; expires_at: string; consumed_at: string | null; redirect_uri: string }>();
    if (!pending || pending.consumed_at || Date.parse(pending.expires_at) <= Date.now() || pending.redirect_uri !== config.callbackUri) throw new SecurityError("STAFF_SAML_STATE_INVALID", 401);
    const profile = await validateSamlResponse(client, samlResponse, relayState);
    const requiredMfaContext = await getSamlMfaRequirement();
    const mfaSatisfied = requiredMfaContext
      ? hasRequiredSamlMfa(profile, requiredMfaContext)
      : (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) === "development";
    const email = String(profile.email || profile.mail || profile["urn:oid:0.9.2342.19200300.100.1.3"] || "").trim().toLowerCase();
    const nameId = String(profile.nameID || "").trim();
    if (!email || !nameId || !profile.issuer || !mfaSatisfied) throw new SecurityError("STAFF_SAML_CLAIMS_INVALID", 401);
    const consumed = await d1.prepare("UPDATE auth_federation_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?").bind(new Date().toISOString(), pending.id, new Date().toISOString()).run();
    if (!consumed.meta.changes) throw new SecurityError("STAFF_SAML_STATE_REPLAYED", 401);
    const externalId = `saml:${profile.issuer}:${nameId}`;
    const displayName = String(profile.displayName || profile.name || email).trim().slice(0, 160);
    let user = await d1.prepare("SELECT id, email, display_name, external_id, status FROM users WHERE external_id = ? AND user_type = 'STAFF'").bind(externalId).first<{ id: string; email: string; display_name: string; external_id: string | null; status: string }>();
    if (!user) {
      user = await d1.prepare("SELECT id, email, display_name, external_id, status FROM users WHERE lower(email) = lower(?) AND user_type = 'STAFF'").bind(email).first<{ id: string; email: string; display_name: string; external_id: string | null; status: string }>();
    }
    if (!user || user.status !== "ACTIVE") throw new SecurityError("STAFF_ACCOUNT_NOT_PROVISIONED", 403);
    const profileScope = await d1.prepare(`SELECT sfa.facility_id, f.organization_id, 0 AS scope_rank
      FROM staff_facility_assignments sfa INNER JOIN facilities f ON f.id = sfa.facility_id
        INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE sfa.user_id = ? AND sfa.status = 'ACTIVE' AND (sfa.organization_id IS NULL OR sfa.organization_id = f.organization_id)
      UNION ALL SELECT sp.facility_id, f.organization_id, 0 AS scope_rank
        FROM staff_profiles sp INNER JOIN facilities f ON f.id = sp.facility_id
          INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
        WHERE sp.user_id = ? AND (sp.organization_id IS NULL OR sp.organization_id = f.organization_id) AND NOT EXISTS (SELECT 1 FROM staff_facility_assignments WHERE user_id = ?)
      UNION ALL SELECT NULL AS facility_id, ora.organization_id, 1 AS scope_rank
        FROM organization_role_assignments ora
        INNER JOIN role_permissions rp ON rp.role_id = ora.role_id
        INNER JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = 'organization.manage'
        INNER JOIN organizations o ON o.id = ora.organization_id AND o.status = 'ACTIVE'
        WHERE ora.user_id = ? AND ora.status = 'ACTIVE'
      ORDER BY scope_rank, facility_id LIMIT 1`).bind(user.id, user.id, user.id, user.id).first<{ facility_id: string | null; organization_id: string | null; scope_rank: number }>();
    if (!profileScope?.organization_id) throw new SecurityError("STAFF_SCOPE_MISSING", 403);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = await getSecuritySalt();
    const sessionResults = await d1.batch([
      // Keep identity binding, login timestamp, session creation, and the
      // audit event in one facility-scoped transaction. The conditional
      // predicate prevents a concurrent first-login from rebinding the
      // provisioned staff record after it was read above.
      d1.prepare("UPDATE users SET external_id = ?, display_name = ?, last_login_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE' AND (external_id IS NULL OR external_id = ?)").bind(externalId, displayName, now, now, user.id, user.external_id),
      d1.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, last_seen_at, device_label, user_agent_hash, ip_hash) SELECT ?, id, ?, ?, ?, ?, ?, ? FROM users WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE' AND external_id = ?").bind(crypto.randomUUID(), await hashIdentifier(token, salt), new Date(Date.now() + 8 * 60 * 60_000).toISOString(), now, describeDevice(context.userAgent), context.userAgent ? await hashIdentifier(context.userAgent, salt) : null, context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null, user.id, externalId),
      d1.prepare("INSERT INTO security_events (id, user_id, organization_id, facility_id, event_type, severity, request_id, metadata, created_at) SELECT ?, id, ?, ?, 'STAFF_SAML_LOGIN', 'INFO', ?, ?, ? FROM users WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE' AND external_id = ?").bind(crypto.randomUUID(), profileScope.organization_id, profileScope.facility_id, context.requestId, JSON.stringify({ issuer: profile.issuer, scope: profileScope.facility_id ? 'FACILITY' : 'ORGANIZATION' }), now, user.id, externalId),
    ]);
    if (!sessionResults[0]?.meta.changes) throw new SecurityError("STAFF_IDENTITY_BINDING_CONFLICT", 409);
    if (!sessionResults[1]?.meta.changes || !sessionResults[2]?.meta.changes) throw new SecurityError("STAFF_FEDERATION_AUDIT_FAILED", 503);
    const response = Response.redirect("/", 303);
    response.headers.set("Set-Cookie", await staffCookie(token));
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) {
    await recordFederationFailure(context, error);
    return securityErrorResponse(error, context.requestId);
  }
}
