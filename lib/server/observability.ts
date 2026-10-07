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

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|otp|nonce|signature|payload|body|evidence|document|credential|private.?key|email|phone|mobile|destination|provider.?reference)/i;

const SENSITIVE_ERROR_TEXT = /(bearer\s+|basic\s+|token\s*[=:]|secret\s*[=:]|password\s*[=:]|otp\s*[=:]|nonce\s*[=:]|signature\s*[=:]|whsec_[a-z0-9_-]+|(?:sk|rk)_(?:live|test)_[a-z0-9_-]+|xnd_[a-z0-9_-]+|SB-Mid-server-[a-z0-9_-]+|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|https?:\/\/[^\s/@]+:[^\s/@]+@|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+\d[\d\s().-]{7,})/i;

/** Returns a bounded provider/runtime error safe to persist in operational records. */
export function safeOperationalErrorMessage(error: unknown, fallback: string, maxLength = 240): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim().slice(0, Math.max(1, maxLength));
  return message && !SENSITIVE_ERROR_TEXT.test(message) ? message : fallback;
}

function redactError(error: Error): { name: string; message: string } {
  return {
    name: error.name,
    message: safeOperationalErrorMessage(error, "[REDACTED]", 256),
  };
}

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) return redactError(value);
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
