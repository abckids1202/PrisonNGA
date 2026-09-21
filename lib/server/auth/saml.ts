import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { getRuntimeValue, SecurityError } from "../security";

export type SamlProfile = Profile & { email?: string; mail?: string; displayName?: string; name?: string };

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

export async function createSamlClient(config: Awaited<ReturnType<typeof getSamlConfig>>): Promise<SAML> {
  const metadata = await fetch(config.metadataUrl, { headers: { accept: "application/xml,text/xml" } });
  if (!metadata.ok) throw new SecurityError("STAFF_SAML_METADATA_UNAVAILABLE", 503);
  const metadataXml = await metadata.text();
  if (!metadataXml.includes("EntityDescriptor") || !metadataXml.includes(config.entityId)) throw new SecurityError("STAFF_SAML_METADATA_INVALID", 503);
  return new SAML({
    callbackUrl: config.callbackUri,
    entryPoint: config.entryPoint,
    idpCert: config.idpCert,
    issuer: config.entityId,
    audience: config.entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: 2 * 60 * 1000,
    disableRequestedAuthnContext: true,
  });
}

export async function samlAuthorize(client: SAML, relayState: string): Promise<string> {
  return client.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlResponse(client: SAML, samlResponse: string, relayState: string): Promise<SamlProfile> {
  const result = await client.validatePostResponseAsync({ SAMLResponse: samlResponse, RelayState: relayState });
  if (!result.profile || result.loggedOut) throw new SecurityError("STAFF_SAML_ASSERTION_INVALID", 401);
  return result.profile as SamlProfile;
}
