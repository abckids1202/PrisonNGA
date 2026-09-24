import { getRuntimeValue } from "../security";

export type StaffFederationConfig = { provider: "none" | "oidc" | "saml" | "both"; configured: boolean; missing: string[]; providers?: Array<"oidc" | "saml">; issuer?: string; entityId?: string; metadataUrl?: string; redirectUri?: string };

export async function getStaffFederationConfig(): Promise<StaffFederationConfig> {
  const rawProvider = (await getRuntimeValue("STAFF_AUTH_PROVIDER"))?.toLowerCase();
  const provider = rawProvider === "oidc" || rawProvider === "saml" || rawProvider === "both" ? rawProvider : "none";
  const providers: Array<"oidc" | "saml"> = provider === "both" ? ["oidc", "saml"] : provider === "none" ? [] : [provider];
  if (provider === "none") return { provider, configured: false, missing: ["STAFF_AUTH_PROVIDER"], providers: [] };
  const oidc = providers.includes("oidc") ? await oidcConfig() : null;
  const saml = providers.includes("saml") ? await samlConfig() : null;
  const missing = [...(oidc?.missing || []), ...(saml?.missing || [])];
  return {
    provider,
    providers: [...providers],
    configured: missing.length === 0,
    missing: [...new Set(missing)],
    issuer: oidc?.issuer,
    redirectUri: oidc?.redirectUri,
    entityId: saml?.entityId,
    metadataUrl: saml?.metadataUrl,
  };
}

async function oidcConfig(): Promise<{ missing: string[]; issuer?: string; redirectUri?: string }> {
    const issuer = await getRuntimeValue("STAFF_OIDC_ISSUER");
    const clientId = await getRuntimeValue("STAFF_OIDC_CLIENT_ID");
    const clientSecret = await getRuntimeValue("STAFF_OIDC_CLIENT_SECRET");
    const redirectUri = await getRuntimeValue("STAFF_OIDC_REDIRECT_URI");
    const missing = [!issuer ? "STAFF_OIDC_ISSUER" : "", !clientId ? "STAFF_OIDC_CLIENT_ID" : "", !clientSecret ? "STAFF_OIDC_CLIENT_SECRET" : "", !redirectUri ? "STAFF_OIDC_REDIRECT_URI" : ""].filter(Boolean);
    let validIssuer = false;
    try { validIssuer = Boolean(issuer && new URL(issuer).protocol === "https:"); } catch { validIssuer = false; }
    if (issuer && !validIssuer) missing.push("STAFF_OIDC_ISSUER_HTTPS");
    let validRedirect = false;
    try { validRedirect = Boolean(redirectUri && new URL(redirectUri).protocol === "https:"); } catch { validRedirect = false; }
    if (redirectUri && !validRedirect) missing.push("STAFF_OIDC_REDIRECT_HTTPS");
    if (!((await getRuntimeValue("STAFF_OIDC_MFA_ACR")) || (await getRuntimeValue("STAFF_OIDC_MFA_AMR")))) missing.push("STAFF_OIDC_MFA_ACR or STAFF_OIDC_MFA_AMR");
    return { missing, issuer: issuer || undefined, redirectUri: redirectUri || undefined };
}

async function samlConfig(): Promise<{ missing: string[]; entityId?: string; metadataUrl?: string }> {
  const entityId = await getRuntimeValue("STAFF_SAML_ENTITY_ID");
  const metadataUrl = await getRuntimeValue("STAFF_SAML_METADATA_URL");
  const missing = [!entityId ? "STAFF_SAML_ENTITY_ID" : "", !metadataUrl ? "STAFF_SAML_METADATA_URL" : ""].filter(Boolean);
  let validMetadata = false;
  try { validMetadata = Boolean(metadataUrl && new URL(metadataUrl).protocol === "https:"); } catch { validMetadata = false; }
  if (metadataUrl && !validMetadata) missing.push("STAFF_SAML_METADATA_HTTPS");
    const entryPoint = await getRuntimeValue("STAFF_SAML_ENTRY_POINT");
    const idpCert = await getRuntimeValue("STAFF_SAML_IDP_CERT");
    const callbackUri = await getRuntimeValue("STAFF_SAML_CALLBACK_URI");
    if (!entryPoint) missing.push("STAFF_SAML_ENTRY_POINT");
    if (!idpCert) missing.push("STAFF_SAML_IDP_CERT");
    if (!callbackUri) missing.push("STAFF_SAML_CALLBACK_URI");
    if (!await getRuntimeValue("STAFF_SAML_MFA_ACR")) missing.push("STAFF_SAML_MFA_ACR");
    return { missing, entityId: entityId || undefined, metadataUrl: metadataUrl || undefined };
}
