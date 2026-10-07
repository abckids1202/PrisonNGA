const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

/** Read a provider response without allowing an unbounded body into memory. */
export async function readBoundedResponseText(response: Response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || "");
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
