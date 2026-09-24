export type RuntimeConfig = Record<string, unknown>;

export type EnvironmentCheck = {
  environment: "development" | "staging" | "production" | "invalid";
  ok: boolean;
  missing: string[];
  warnings: string[];
};

function value(env: RuntimeConfig, key: string): string {
  const candidate = env[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function validateEnvironment(env: RuntimeConfig): EnvironmentCheck {
  const configuredEnvironment = value(env, "SECUREVISIT_ENVIRONMENT");
  const environment = configuredEnvironment === "production" || configuredEnvironment === "staging" || configuredEnvironment === "development"
    ? configuredEnvironment
    : "invalid";
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!env.DB) missing.push("DB");
  if (environment === "invalid") {
    missing.push("SECUREVISIT_ENVIRONMENT (must be explicitly development, staging, or production)");
    return { environment, ok: false, missing, warnings };
  }
  if (environment === "development") {
    if (!value(env, "SECUREVISIT_HASH_SALT")) warnings.push("SECUREVISIT_HASH_SALT uses the development fallback");
    return { environment, ok: missing.length === 0, missing, warnings };
  }
  if (configuredEnvironment !== environment) missing.push("SECUREVISIT_ENVIRONMENT");
  if (value(env, "SECUREVISIT_HASH_SALT").length < 32) missing.push("SECUREVISIT_HASH_SALT");
  if (value(env, "STAFF_STEP_UP_SECRET").length < 32) missing.push("STAFF_STEP_UP_SECRET");
  const visitorDelivery = value(env, "VISITOR_AUTH_DELIVERY");
  if (visitorDelivery !== "webhook") missing.push("VISITOR_AUTH_DELIVERY=webhook");
  if (visitorDelivery === "webhook") {
    if (!/^https:\/\//i.test(value(env, "VISITOR_AUTH_WEBHOOK_URL"))) missing.push("VISITOR_AUTH_WEBHOOK_URL");
    if (!value(env, "VISITOR_AUTH_WEBHOOK_SECRET")) missing.push("VISITOR_AUTH_WEBHOOK_SECRET");
  }
  if (value(env, "VIDEO_PROVIDER") !== "livekit") missing.push("VIDEO_PROVIDER=livekit");
  for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) if (!value(env, key)) missing.push(key);
  if (!env.EVIDENCE_BUCKET) missing.push("EVIDENCE_BUCKET");
  const evidenceScanProvider = value(env, "EVIDENCE_SCAN_PROVIDER");
  if (evidenceScanProvider !== "webhook") missing.push("EVIDENCE_SCAN_PROVIDER=webhook");
  if (evidenceScanProvider === "webhook") {
    if (!/^https:\/\//i.test(value(env, "EVIDENCE_SCAN_WEBHOOK_URL"))) missing.push("EVIDENCE_SCAN_WEBHOOK_URL");
    if (!value(env, "EVIDENCE_SCAN_WEBHOOK_SECRET")) missing.push("EVIDENCE_SCAN_WEBHOOK_SECRET");
  }
  if (value(env, "PAYMENT_PROVIDER") !== "webhook") missing.push("PAYMENT_PROVIDER=webhook");
  const visitCreditPrice = Number(value(env, "VISIT_CREDIT_PRICE_MINOR"));
  if (!Number.isSafeInteger(visitCreditPrice) || visitCreditPrice <= 0) missing.push("VISIT_CREDIT_PRICE_MINOR");
  if (!/^https:\/\//i.test(value(env, "PAYMENT_CHECKOUT_URL"))) missing.push("PAYMENT_CHECKOUT_URL");
  if (!value(env, "PAYMENT_PROVIDER_SECRET")) missing.push("PAYMENT_PROVIDER_SECRET");
  if (!value(env, "PAYMENT_WEBHOOK_SECRET")) missing.push("PAYMENT_WEBHOOK_SECRET");
  if (value(env, "NOTIFICATION_DELIVERY") !== "webhook") missing.push("NOTIFICATION_DELIVERY=webhook");
  if (!/^https:\/\//i.test(value(env, "NOTIFICATION_WEBHOOK_URL"))) missing.push("NOTIFICATION_WEBHOOK_URL");
  if (!value(env, "NOTIFICATION_WEBHOOK_SECRET")) missing.push("NOTIFICATION_WEBHOOK_SECRET");
  const staffProvider = value(env, "STAFF_AUTH_PROVIDER");
  if (staffProvider !== "oidc" && staffProvider !== "saml") missing.push("STAFF_AUTH_PROVIDER");
  if (staffProvider === "oidc") {
    if (!/^https:\/\//i.test(value(env, "STAFF_OIDC_ISSUER"))) missing.push("STAFF_OIDC_ISSUER");
    if (!value(env, "STAFF_OIDC_CLIENT_ID")) missing.push("STAFF_OIDC_CLIENT_ID");
    if (!value(env, "STAFF_OIDC_CLIENT_SECRET")) missing.push("STAFF_OIDC_CLIENT_SECRET");
    if (!/^https:\/\//i.test(value(env, "STAFF_OIDC_REDIRECT_URI"))) missing.push("STAFF_OIDC_REDIRECT_URI");
  }
  if (staffProvider === "saml") {
    if (!value(env, "STAFF_SAML_ENTITY_ID")) missing.push("STAFF_SAML_ENTITY_ID");
    if (!/^https:\/\//i.test(value(env, "STAFF_SAML_METADATA_URL"))) missing.push("STAFF_SAML_METADATA_URL");
    if (!/^https:\/\//i.test(value(env, "STAFF_SAML_ENTRY_POINT"))) missing.push("STAFF_SAML_ENTRY_POINT");
    if (!value(env, "STAFF_SAML_IDP_CERT")) missing.push("STAFF_SAML_IDP_CERT");
    if (!/^https:\/\//i.test(value(env, "STAFF_SAML_CALLBACK_URI"))) missing.push("STAFF_SAML_CALLBACK_URI");
  }
  return { environment, ok: missing.length === 0, missing: [...new Set(missing)], warnings };
}
