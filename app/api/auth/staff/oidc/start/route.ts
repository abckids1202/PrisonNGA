import { getD1 } from "../../../../../../db/runtime";
import { createPkcePair, discover, getOidcConfig, hashFederationState } from "../../../../../../lib/server/auth/oidc";
import { applySecurityHeaders, getRequestContext, securityErrorResponse } from "../../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const config = await getOidcConfig();
    const discovery = await discover(config);
    const pair = createPkcePair();
    const challenge = await pair.challenge;
    const now = new Date();
    const d1 = await getD1();
    await d1.prepare("INSERT INTO auth_federation_states (id, provider, state_hash, nonce, code_verifier, redirect_uri, expires_at, created_at) VALUES (?, 'oidc', ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), await hashFederationState(pair.state), pair.nonce, pair.verifier, config.redirectUri, new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString()).run();
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: "openid email profile", state: pair.state, nonce: pair.nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    const response = Response.redirect(url.toString(), 302);
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
