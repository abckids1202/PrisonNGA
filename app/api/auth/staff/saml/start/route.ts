import { getD1 } from "../../../../../../db/runtime";
import { createSamlClient, getSamlConfig, samlAuthorize } from "../../../../../../lib/server/auth/saml";
import { hashFederationState } from "../../../../../../lib/server/auth/oidc";
import { applySecurityHeaders, getRequestContext, securityErrorResponse } from "../../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const config = await getSamlConfig();
    const client = await createSamlClient(config);
    const relayState = crypto.randomUUID() + crypto.randomUUID();
    const now = new Date();
    const d1 = await getD1();
    await d1.prepare("INSERT INTO auth_federation_states (id, provider, state_hash, nonce, code_verifier, redirect_uri, expires_at, created_at) VALUES (?, 'saml', ?, ?, '', ?, ?, ?)")
      .bind(crypto.randomUUID(), await hashFederationState(relayState), crypto.randomUUID(), config.callbackUri, new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString()).run();
    const response = Response.redirect(await samlAuthorize(client, relayState), 302);
    applySecurityHeaders(response, context.requestId);
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
