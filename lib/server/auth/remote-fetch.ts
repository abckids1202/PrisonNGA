import { SecurityError } from "../security";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_048_576;

export async function fetchBoundedText(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
      const contentLength = Number(response.headers.get("content-length") || "");
      if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) throw new Error("REMOTE_RESPONSE_TOO_LARGE");
      if (!response.body) return { response, text: "" };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;
      let text = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
          if (totalBytes > maxBytes) throw new Error("REMOTE_RESPONSE_TOO_LARGE");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      return { response, text };
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw new SecurityError("FEDERATION_PROVIDER_UNAVAILABLE", 503);
    }
  } finally {
    clearTimeout(timeout);
  }
}
