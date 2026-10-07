import { SecurityError } from "./security";

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
