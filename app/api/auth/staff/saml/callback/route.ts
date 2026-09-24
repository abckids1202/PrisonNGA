import { getD1 } from "../../../../../../db/runtime";
import { createSamlClient, getSamlConfig, getSamlMfaRequirement, hasRequiredSamlMfa, validateSamlResponse } from "../../../../../../lib/server/auth/saml";
import { hashFederationState } from "../../../../../../lib/server/auth/oidc";
import { applySecurityHeaders, getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";

async function staffCookie(token: string): Promise<string> { return `securevisit_staff_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${(await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development" ? "; Secure" : ""}`; }

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const form = await request.formData();
    const samlResponse = form.get("SAMLResponse");
    const relayState = form.get("RelayState");
    if (typeof samlResponse !== "string" || samlResponse.length > 250_000 || typeof relayState !== "string" || !relayState) throw new SecurityError("STAFF_SAML_CALLBACK_INVALID", 400);
    const config = await getSamlConfig();
    const d1 = await getD1();
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
    let user = await d1.prepare("SELECT id, email, display_name, status FROM users WHERE external_id = ? AND user_type = 'STAFF'").bind(externalId).first<{ id: string; email: string; display_name: string; status: string }>();
    if (!user) {
      user = await d1.prepare("SELECT id, email, display_name, status FROM users WHERE lower(email) = lower(?) AND user_type = 'STAFF'").bind(email).first<{ id: string; email: string; display_name: string; status: string }>();
      if (user) await d1.prepare("UPDATE users SET external_id = ?, display_name = ?, last_login_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_type = 'STAFF'").bind(externalId, displayName, new Date().toISOString(), new Date().toISOString(), user.id).run();
    }
    if (!user || user.status !== "ACTIVE") throw new SecurityError("STAFF_ACCOUNT_NOT_PROVISIONED", 403);
    const profileScope = await d1.prepare("SELECT facility_id FROM staff_profiles WHERE user_id = ?").bind(user.id).first<{ facility_id: string }>();
    if (!profileScope) throw new SecurityError("STAFF_FACILITY_SCOPE_MISSING", 403);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = await getSecuritySalt();
    await d1.batch([
      d1.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, last_seen_at, user_agent_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, await hashIdentifier(token, salt), new Date(Date.now() + 8 * 60 * 60_000).toISOString(), now, context.userAgent ? await hashIdentifier(context.userAgent, salt) : null, context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null),
      d1.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id),
      d1.prepare("INSERT INTO security_events (id, user_id, facility_id, event_type, severity, request_id, metadata, created_at) VALUES (?, ?, ?, 'STAFF_SAML_LOGIN', 'INFO', ?, ?, ?)").bind(crypto.randomUUID(), user.id, profileScope.facility_id, context.requestId, JSON.stringify({ issuer: profile.issuer }), now),
    ]);
    const response = Response.redirect("/", 303);
    response.headers.set("Set-Cookie", await staffCookie(token));
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
