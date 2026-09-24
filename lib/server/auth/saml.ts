import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile, type SamlConfig } from "@node-saml/node-saml";
import { getRuntimeValue, SecurityError } from "../security";

export type SamlProfile = Profile & { email?: string; mail?: string; displayName?: string; name?: string };
export const SAML_REQUEST_CACHE_TTL_MS = 10 * 60 * 1000;

export function hasRequiredSamlMfa(profile: SamlProfile, requiredAuthnContext: string): boolean {
  const assertion = profile.getAssertion?.() as { Assertion?: Array<{ AuthnStatement?: Array<{ AuthnContext?: Array<{ AuthnContextClassRef?: Array<{ _: string }> }> }> }> } | undefined;
  const contexts = assertion?.Assertion?.flatMap((item) => item.AuthnStatement || [])
    .flatMap((item) => item.AuthnContext || [])
    .flatMap((item) => item.AuthnContextClassRef || [])
    .map((item) => item._)
    .filter(Boolean) || [];
  return contexts.includes(requiredAuthnContext);
}

export async function getSamlMfaRequirement(): Promise<string | null> {
  return (await getRuntimeValue("STAFF_SAML_MFA_ACR"))?.trim() || null;
}

type SamlRequestCacheRow = { issue_instant: string; created_at: string; state_hash: string };

/** Node-SAML's default request cache is process-local; callbacks may reach another Worker isolate. */
export class D1SamlCacheProvider implements CacheProvider {
  constructor(private readonly database: D1Database, private readonly stateHash: string, private readonly ttlMs = SAML_REQUEST_CACHE_TTL_MS) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const now = new Date();
    const createdAt = now.toISOString();
    const pruneBefore = new Date(now.getTime() - this.ttlMs).toISOString();
    const results = await this.database.batch([
      this.database.prepare("DELETE FROM saml_request_cache WHERE created_at <= ?").bind(pruneBefore),
      this.database.prepare("INSERT OR IGNORE INTO saml_request_cache (request_id, issue_instant, state_hash, created_at) VALUES (?, ?, ?, ?)").bind(key, value, this.stateHash, createdAt),
    ]);
    if (!results[1]?.meta.changes) return null;
    return { value, createdAt: now.getTime() };
  }

  async getAsync(key: string): Promise<string | null> {
    const row = await this.database.prepare("SELECT issue_instant, created_at, state_hash FROM saml_request_cache WHERE request_id = ?")
      .bind(key).first<SamlRequestCacheRow>();
    if (!row) return null;
    const createdAt = Date.parse(row.created_at);
    if (row.state_hash !== this.stateHash) return null;
    if (!Number.isFinite(createdAt) || Date.now() - createdAt >= this.ttlMs) {
      await this.database.prepare("DELETE FROM saml_request_cache WHERE request_id = ? AND state_hash = ?").bind(key, this.stateHash).run();
      return null;
    }
    return row.issue_instant;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const result = await this.database.prepare("DELETE FROM saml_request_cache WHERE request_id = ? AND state_hash = ?").bind(key, this.stateHash).run();
    return result.meta.changes ? key : null;
  }
}

export async function getSamlConfig(): Promise<{ entityId: string; metadataUrl: string; entryPoint: string; idpCert: string; callbackUri: string }> {
  const entityId = await getRuntimeValue("STAFF_SAML_ENTITY_ID");
  const metadataUrl = await getRuntimeValue("STAFF_SAML_METADATA_URL");
  const entryPoint = await getRuntimeValue("STAFF_SAML_ENTRY_POINT");
  const idpCert = await getRuntimeValue("STAFF_SAML_IDP_CERT");
  const callbackUri = await getRuntimeValue("STAFF_SAML_CALLBACK_URI");
  if (!entityId || !metadataUrl || !entryPoint || !idpCert || !callbackUri) throw new SecurityError("STAFF_SAML_NOT_CONFIGURED", 503);
  for (const value of [metadataUrl, entryPoint, callbackUri]) { try { if (new URL(value).protocol !== "https:") throw new Error("https required"); } catch { throw new SecurityError("STAFF_SAML_ENDPOINT_INVALID", 503); } }
  return { entityId, metadataUrl, entryPoint, idpCert, callbackUri };
}

export function createSamlClientOptions(config: Awaited<ReturnType<typeof getSamlConfig>>, database: D1Database, stateHash: string, requestedAuthnContext: string | null = null): SamlConfig {
  return {
    callbackUrl: config.callbackUri,
    entryPoint: config.entryPoint,
    idpCert: config.idpCert,
    issuer: config.entityId,
    audience: config.entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_CACHE_TTL_MS,
    cacheProvider: new D1SamlCacheProvider(database, stateHash),
    acceptedClockSkewMs: 2 * 60 * 1000,
    authnContext: requestedAuthnContext ? [requestedAuthnContext] : undefined,
    disableRequestedAuthnContext: !requestedAuthnContext,
  };
}

export async function createSamlClient(config: Awaited<ReturnType<typeof getSamlConfig>>, database: D1Database, stateHash: string): Promise<SAML> {
  const metadata = await fetch(config.metadataUrl, { headers: { accept: "application/xml,text/xml" } });
  if (!metadata.ok) throw new SecurityError("STAFF_SAML_METADATA_UNAVAILABLE", 503);
  const metadataXml = await metadata.text();
  if (!metadataXml.includes("EntityDescriptor") || !metadataXml.includes(config.entityId)) throw new SecurityError("STAFF_SAML_METADATA_INVALID", 503);
  return new SAML(createSamlClientOptions(config, database, stateHash, await getSamlMfaRequirement()));
}

export async function samlAuthorize(client: SAML, relayState: string): Promise<string> {
  return client.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlResponse(client: SAML, samlResponse: string, relayState: string): Promise<SamlProfile> {
  const result = await client.validatePostResponseAsync({ SAMLResponse: samlResponse, RelayState: relayState });
  if (!result.profile || result.loggedOut) throw new SecurityError("STAFF_SAML_ASSERTION_INVALID", 401);
  return result.profile as SamlProfile;
}
