import { SecurityError } from "./security";

/** Checks a request body without consuming the original stream used by the route handler. */
export async function assertRequestBodyWithinLimit(request: Request, maxBytes: number): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("REQUEST_BODY_LIMIT_INVALID");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new SecurityError("REQUEST_BODY_TOO_LARGE", 413);
  }
  if (!request.body) return;
  const reader = request.clone().body?.getReader();
  if (!reader) return;
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        // Do not await cancellation here. Some Fetch implementations keep a
        // cloned request stream pending while cancellation propagates; the
        // original request remains available to the handler and the caller
        // should receive the bounded-body error immediately.
        void reader.cancel();
        throw new SecurityError("REQUEST_BODY_TOO_LARGE", 413);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readTextBodyWithinLimit(request: Request, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("REQUEST_BODY_LIMIT_INVALID");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new SecurityError("REQUEST_BODY_TOO_LARGE", 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new SecurityError("REQUEST_BODY_TOO_LARGE", 413);
  return body;
}
