import { SecurityError } from "../security";

export type ResendDeliveryEvent = {
  eventId: string;
  providerReference: string;
  status: "SENT" | "DELIVERED" | "PROCESSING" | "BOUNCED" | "REJECTED" | "FAILED";
  errorCode?: string;
  errorMessage?: string;
};

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try { binary = atob(normalized); } catch { throw new SecurityError("RESEND_WEBHOOK_SIGNATURE_INVALID", 401); }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requireHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() || "";
  if (!value || value.length > 512) throw new SecurityError("RESEND_WEBHOOK_SIGNATURE_INVALID", 401);
  return value;
}

/** Verify Resend's native Svix signature over the raw request body. */
export async function verifyResendWebhook(body: string, headers: Headers, webhookSecret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<void> {
  const id = requireHeader(headers, "svix-id");
  const timestamp = requireHeader(headers, "svix-timestamp");
  const timestampSeconds = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) throw new SecurityError("RESEND_WEBHOOK_TIMESTAMP_INVALID", 401);
  const supplied = headers.get("svix-signature")?.trim() || "";
  if (!supplied || supplied.length > 2048) throw new SecurityError("RESEND_WEBHOOK_SIGNATURE_INVALID", 401);
  const secretValue = webhookSecret.startsWith("whsec_") ? webhookSecret.slice("whsec_".length) : webhookSecret;
  const secretBytes = decodeBase64(secretValue);
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secretBytes).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signedPayload = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const checks = supplied.split(" ").map((part) => {
    const [version, encoded] = part.split(",", 2);
    if (version !== "v1" || !encoded) return false;
    try { return crypto.subtle.verify("HMAC", key, new Uint8Array(decodeBase64(encoded)).buffer as ArrayBuffer, signedPayload); }
    catch { return false; }
  });
  if (!(await Promise.all(checks)).some(Boolean)) throw new SecurityError("RESEND_WEBHOOK_SIGNATURE_INVALID", 401);
}

/** Map only provider events that affect SecureVisit delivery state. */
export function normalizeResendDeliveryEvent(input: unknown, eventId: string): ResendDeliveryEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityError("RESEND_WEBHOOK_INVALID", 400);
  const envelope = input as { type?: unknown; data?: unknown };
  const type = typeof envelope.type === "string" ? envelope.type.trim().toLowerCase() : "";
  if (!type.startsWith("email.")) return null;
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) throw new SecurityError("RESEND_WEBHOOK_INVALID", 400);
  const data = envelope.data as { email_id?: unknown; id?: unknown; bounce?: unknown; failed?: unknown };
  const providerReference = typeof data.email_id === "string" ? data.email_id.trim() : typeof data.id === "string" ? data.id.trim() : "";
  if (!providerReference || providerReference.length > 256 || !eventId || eventId.length > 256) throw new SecurityError("RESEND_WEBHOOK_INVALID", 400);
  const details = data.bounce && typeof data.bounce === "object" && !Array.isArray(data.bounce) ? data.bounce as { type?: unknown; subType?: unknown; message?: unknown } : {};
  const errorCode = typeof details.subType === "string" ? details.subType.trim().slice(0, 120) : typeof details.type === "string" ? details.type.trim().slice(0, 120) : undefined;
  const errorMessage = typeof details.message === "string" ? details.message.trim().slice(0, 500) : undefined;
  const status: ResendDeliveryEvent["status"] = type === "email.sent" ? "SENT"
    : type === "email.delivered" ? "DELIVERED"
    : type === "email.delivery_delayed" ? "PROCESSING"
    : type === "email.bounced" ? "BOUNCED"
    : type === "email.suppressed" || type === "email.complained" ? "REJECTED"
    : type === "email.failed" ? "FAILED"
    : (() => { throw new SecurityError("RESEND_WEBHOOK_UNSUPPORTED", 400); })();
  return { eventId, providerReference, status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) };
}
