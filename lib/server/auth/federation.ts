import { getRuntimeValue } from "../security";

export type StaffFederationConfig = { provider: "none" | "oidc" | "saml"; configured: boolean; missing: string[]; issuer?: string; entityId?: string; metadataUrl?: string; redirectUri?: string };

export async function getStaffFederationConfig(): Promise<StaffFederationConfig> {
  const rawProvider = (await getRuntimeValue("STAFF_AUTH_PROVIDER"))?.toLowerCase();
  const provider = rawProvider === "oidc" || rawProvider === "saml" ? rawProvider : "none";
  if (provider === "none") return { provider, configured: false, missing: ["STAFF_AUTH_PROVIDER"] };
  if (provider === "oidc") {
    const issuer = await getRuntimeValue("STAFF_OIDC_ISSUER");
    const clientId = await getRuntimeValue("STAFF_OIDC_CLIENT_ID");
    const redirectUri = await getRuntimeValue("STAFF_OIDC_REDIRECT_URI");
    const missing = [!issuer ? "STAFF_OIDC_ISSUER" : "", !clientId ? "STAFF_OIDC_CLIENT_ID" : "", !redirectUri ? "STAFF_OIDC_REDIRECT_URI" : ""].filter(Boolean);
    let validIssuer = false;
    try { validIssuer = Boolean(issuer && new URL(issuer).protocol === "https:"); } catch { validIssuer = false; }
    if (issuer && !validIssuer) missing.push("STAFF_OIDC_ISSUER_HTTPS");
    let validRedirect = false;
    try { validRedirect = Boolean(redirectUri && new URL(redirectUri).protocol === "https:"); } catch { validRedirect = false; }
    if (redirectUri && !validRedirect) missing.push("STAFF_OIDC_REDIRECT_HTTPS");
    return { provider, configured: missing.length === 0, missing, issuer: issuer || undefined, redirectUri: redirectUri || undefined };
  }
  const entityId = await getRuntimeValue("STAFF_SAML_ENTITY_ID");
  const metadataUrl = await getRuntimeValue("STAFF_SAML_METADATA_URL");
  const missing = [!entityId ? "STAFF_SAML_ENTITY_ID" : "", !metadataUrl ? "STAFF_SAML_METADATA_URL" : ""].filter(Boolean);
  let validMetadata = false;
  try { validMetadata = Boolean(metadataUrl && new URL(metadataUrl).protocol === "https:"); } catch { validMetadata = false; }
  if (metadataUrl && !validMetadata) missing.push("STAFF_SAML_METADATA_HTTPS");
  return { provider, configured: missing.length === 0, missing, entityId: entityId || undefined, metadataUrl: metadataUrl || undefined };
}
