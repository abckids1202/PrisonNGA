export type OperationalLogLevel = "info" | "warn" | "error";

export type OperationalLogContext = {
  event: string;
  requestId?: string | null;
  correlationId?: string | null;
  facilityId?: string | null;
  actorId?: string | null;
  sessionId?: string | null;
  [key: string]: unknown;
};

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|otp|nonce|signature|payload|body|evidence|document|credential|private.?key)/i;

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

/** Emits one consistent, redacted operational event for Worker/runtime diagnostics. */
export function operationalLog(level: OperationalLogLevel, context: OperationalLogContext): void {
  const record = redact({ timestamp: new Date().toISOString(), service: "securevisit", ...context }) as Record<string, unknown>;
  console[level](JSON.stringify(record));
}
