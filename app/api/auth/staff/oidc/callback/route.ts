import { getD1 } from "../../../../../../db/runtime";
import { discover, exchangeCode, getOidcConfig, hasVerifiedStaffEmail, hashFederationState } from "../../../../../../lib/server/auth/oidc";
import { applySecurityHeaders, getRequestContext, getRuntimeValue, getSecuritySalt, hashIdentifier, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";

async function staffCookie(token: string): Promise<string> { return `securevisit_staff_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${(await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development" ? "; Secure" : ""}`; }

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const search = new URL(request.url).searchParams;
    const code = search.get("code")?.trim() || "";
    const state = search.get("state")?.trim() || "";
    if (search.get("error") || !code || !state) throw new SecurityError("STAFF_OIDC_CALLBACK_INVALID", 400);
    const config = await getOidcConfig();
    const d1 = await getD1();
    const stateHash = await hashFederationState(state);
    const pending = await d1.prepare("SELECT id, nonce, code_verifier, redirect_uri, expires_at, consumed_at FROM auth_federation_states WHERE state_hash = ? AND provider = 'oidc'").bind(stateHash).first<{ id: string; nonce: string; code_verifier: string; redirect_uri: string; expires_at: string; consumed_at: string | null }>();
    if (!pending || pending.consumed_at || Date.parse(pending.expires_at) <= Date.now() || pending.redirect_uri !== config.redirectUri) throw new SecurityError("STAFF_OIDC_STATE_INVALID", 401);
    const discovery = await discover(config);
    const claims = await exchangeCode(discovery, config, code, pending.code_verifier);
    if (claims.nonce !== pending.nonce || !hasVerifiedStaffEmail(claims)) throw new SecurityError("STAFF_OIDC_CLAIMS_INVALID", 401);
    const externalId = `oidc:${claims.iss}:${claims.sub}`;
    const displayName = (claims.name || claims.preferred_username || claims.email).trim().slice(0, 160);
    const consumed = await d1.prepare("UPDATE auth_federation_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?").bind(new Date().toISOString(), pending.id, new Date().toISOString()).run();
    if (!consumed.meta.changes) throw new SecurityError("STAFF_OIDC_STATE_REPLAYED", 401);
    let user = await d1.prepare("SELECT id, email, display_name, status FROM users WHERE external_id = ? AND user_type = 'STAFF'").bind(externalId).first<{ id: string; email: string; display_name: string; status: string }>();
    if (!user) {
      user = await d1.prepare("SELECT id, email, display_name, status FROM users WHERE lower(email) = lower(?) AND user_type = 'STAFF'").bind(claims.email).first<{ id: string; email: string; display_name: string; status: string }>();
      if (user) await d1.prepare("UPDATE users SET external_id = ?, display_name = ?, last_login_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_type = 'STAFF'").bind(externalId, displayName, new Date().toISOString(), new Date().toISOString(), user.id).run();
    }
    if (!user || user.status !== "ACTIVE") throw new SecurityError("STAFF_ACCOUNT_NOT_PROVISIONED", 403);
    const profile = await d1.prepare("SELECT facility_id FROM staff_profiles WHERE user_id = ?").bind(user.id).first<{ facility_id: string }>();
    if (!profile) throw new SecurityError("STAFF_FACILITY_SCOPE_MISSING", 403);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = await getSecuritySalt();
    await d1.batch([
      d1.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, last_seen_at, user_agent_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, await hashIdentifier(token, salt), new Date(Date.now() + 8 * 60 * 60_000).toISOString(), now, context.userAgent ? await hashIdentifier(context.userAgent, salt) : null, context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null),
      d1.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id),
      d1.prepare("INSERT INTO security_events (id, user_id, facility_id, event_type, severity, request_id, metadata, created_at) VALUES (?, ?, ?, 'STAFF_OIDC_LOGIN', 'INFO', ?, ?, ?)").bind(crypto.randomUUID(), user.id, profile.facility_id, context.requestId, JSON.stringify({ issuer: claims.iss }), now),
    ]);
    const response = Response.redirect("/", 303);
    response.headers.set("Set-Cookie", await staffCookie(token));
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
