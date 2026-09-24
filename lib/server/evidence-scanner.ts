import { getRuntimeValue } from "./security";

export type EvidenceScanVerdict = "CLEAN" | "INFECTED";

type EvidenceScanInput = {
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  byteSize: number;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function scanEvidence(input: EvidenceScanInput): Promise<EvidenceScanVerdict> {
  const environment = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT") || "development").toLowerCase();
  const provider = (await getRuntimeValue("EVIDENCE_SCAN_PROVIDER") || "none").toLowerCase();
  if (provider === "none" || provider === "development") {
    if (environment === "development") return "CLEAN";
    throw new Error("EVIDENCE_SCAN_NOT_CONFIGURED");
  }
  if (provider !== "webhook") throw new Error("EVIDENCE_SCAN_PROVIDER_UNSUPPORTED");
  const url = (await getRuntimeValue("EVIDENCE_SCAN_WEBHOOK_URL")) || "";
  const secret = (await getRuntimeValue("EVIDENCE_SCAN_WEBHOOK_SECRET")) || "";
  if (!/^https:\/\//i.test(url) || !secret) throw new Error("EVIDENCE_SCAN_NOT_CONFIGURED");

  const payload = JSON.stringify({
    type: "SECUREVISIT_EVIDENCE_SCAN",
    sha256: input.sha256,
    contentType: input.contentType,
    byteSize: input.byteSize,
    contentBase64: toBase64(input.bytes),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await sign(`${timestamp}.${payload}`, secret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-securevisit-timestamp": timestamp,
        "x-securevisit-signature": `sha256=${signature}`,
        "idempotency-key": input.sha256,
      },
      body: payload,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`EVIDENCE_SCAN_FAILED_${response.status}`);
    const result = await response.json() as { verdict?: unknown };
    if (result.verdict === "clean") return "CLEAN";
    if (result.verdict === "infected") return "INFECTED";
    throw new Error("EVIDENCE_SCAN_INVALID_RESPONSE");
  } finally {
    clearTimeout(timeout);
  }
}
