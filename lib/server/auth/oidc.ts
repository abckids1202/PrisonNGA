import { getRuntimeValue, SecurityError } from "../security";

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
export type OidcClaims = { iss: string; sub: string; aud: string | string[]; exp: number; nonce?: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string; acr?: string; amr?: string[] };

export type StaffMfaRequirement = { acr: string | null; amr: string[] };

export function hasRequiredStaffMfa(claims: Pick<OidcClaims, "acr" | "amr">, requirement: StaffMfaRequirement): boolean {
  if (requirement.acr && claims.acr !== requirement.acr) return false;
  if (requirement.amr.length && !requirement.amr.some((method) => claims.amr?.includes(method))) return false;
  return Boolean(requirement.acr || requirement.amr.length);
}

export async function getStaffMfaRequirement(): Promise<StaffMfaRequirement> {
  const acr = (await getRuntimeValue("STAFF_OIDC_MFA_ACR"))?.trim() || null;
  const amr = (await getRuntimeValue("STAFF_OIDC_MFA_AMR") || "").split(",").map((item) => item.trim()).filter(Boolean);
  return { acr, amr: [...new Set(amr)] };
}

export function hasVerifiedStaffEmail(claims: Pick<OidcClaims, "email" | "email_verified">): claims is Pick<OidcClaims, "email" | "email_verified"> & { email: string; email_verified: true } {
  return typeof claims.email === "string" && claims.email.trim().length > 0 && claims.email_verified === true;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function hashFederationState(state: string): Promise<string> { return base64Url(await sha256(state)); }

export async function getOidcConfig(): Promise<{ issuer: string; clientId: string; clientSecret: string; redirectUri: string }> {
  const issuer = (await getRuntimeValue("STAFF_OIDC_ISSUER"))?.replace(/\/$/, "") || "";
  const clientId = await getRuntimeValue("STAFF_OIDC_CLIENT_ID") || "";
  const clientSecret = await getRuntimeValue("STAFF_OIDC_CLIENT_SECRET") || "";
  const redirectUri = await getRuntimeValue("STAFF_OIDC_REDIRECT_URI") || "";
  let validIssuer = false;
  try { validIssuer = new URL(issuer).protocol === "https:"; } catch { validIssuer = false; }
  if (!validIssuer || !clientId || !clientSecret || !redirectUri) throw new SecurityError("STAFF_OIDC_NOT_CONFIGURED", 503);
  try { if (new URL(redirectUri).protocol !== "https:") throw new Error("redirect"); } catch { throw new SecurityError("STAFF_OIDC_REDIRECT_INVALID", 503); }
  return { issuer, clientId, clientSecret, redirectUri };
}

export async function discover(config: { issuer: string }): Promise<Discovery> {
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new SecurityError("STAFF_OIDC_DISCOVERY_FAILED", 503);
  const body = await response.json() as Partial<Discovery>;
  if (body.issuer !== config.issuer || !isHttps(body.authorization_endpoint) || !isHttps(body.token_endpoint) || !isHttps(body.jwks_uri)) throw new SecurityError("STAFF_OIDC_DISCOVERY_INVALID", 503);
  return body as Discovery;
}

export function createPkcePair(): { state: string; nonce: string; verifier: string; challenge: Promise<string> } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = base64Url(bytes);
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  return { state, nonce, verifier, challenge: sha256(verifier).then(base64Url) };
}

export async function exchangeCode(discovery: Discovery, config: { clientId: string; clientSecret: string; redirectUri: string }, code: string, verifier: string): Promise<OidcClaims> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier });
  form.set("client_secret", config.clientSecret);
  const response = await fetch(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form });
  if (!response.ok) throw new SecurityError("STAFF_OIDC_TOKEN_EXCHANGE_FAILED", 401);
  const body = await response.json() as { id_token?: string };
  if (!body.id_token) throw new SecurityError("STAFF_OIDC_ID_TOKEN_MISSING", 401);
  return verifyIdToken(body.id_token, discovery, config.clientId, await getRuntimeValue("STAFF_OIDC_EXPECTED_AUDIENCE") || config.clientId);
}

async function verifyIdToken(token: string, discovery: Discovery, clientId: string, expectedAudience: string): Promise<OidcClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SecurityError("STAFF_OIDC_ID_TOKEN_INVALID", 401);
  const header = parseJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = parseJson<OidcClaims>(parts[1]);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (header.alg !== "RS256" || !header.kid || claims.iss !== discovery.issuer || !claims.sub || claims.exp * 1000 <= Date.now() || !audiences.includes(clientId) || (expectedAudience && !audiences.includes(expectedAudience))) throw new SecurityError("STAFF_OIDC_ID_TOKEN_INVALID", 401);
  const jwksResponse = await fetch(discovery.jwks_uri, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new SecurityError("STAFF_OIDC_KEYS_UNAVAILABLE", 503);
  const jwks = await jwksResponse.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string; kty?: string }> };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new SecurityError("STAFF_OIDC_KEY_NOT_FOUND", 401);
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new SecurityError("STAFF_OIDC_ID_TOKEN_INVALID", 401);
  return claims;
}

function parseJson<T>(value: string): T { try { return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T; } catch { throw new SecurityError("STAFF_OIDC_ID_TOKEN_INVALID", 401); } }
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4); const binary = atob(padded); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes; }
function isHttps(value: unknown): value is string { try { return typeof value === "string" && new URL(value).protocol === "https:"; } catch { return false; } }
