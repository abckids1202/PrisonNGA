import { getEvidenceBucket, getRecordingBucket } from "../../db/runtime";
import { getRuntimeValue } from "./security";

export type EvidenceObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  /** Provider checksum, normalized to lowercase hexadecimal when available. */
  checksumSha256?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type EvidenceStore = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<EvidenceObject | null>;
  delete(key: string): Promise<void>;
};

const localObjects = new Map<string, Uint8Array>();

const localDevelopmentStore: EvidenceStore = {
  async put(key, value) {
    localObjects.set(key, new Uint8Array(value));
  },
  async get(key) {
    const bytes = localObjects.get(key);
    if (!bytes) return null;
    const copy = new Uint8Array(bytes);
    const digest = await crypto.subtle.digest("SHA-256", copy);
    return {
      body: new Response(copy).body!,
      size: copy.byteLength,
      checksumSha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      arrayBuffer: async () => copy.slice().buffer,
    };
  },
  async delete(key) {
    localObjects.delete(key);
  },
};

export async function getEvidenceStore(): Promise<EvidenceStore | null> {
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  const provider = (await getRuntimeValue("EVIDENCE_STORAGE_PROVIDER") || "r2").toLowerCase();
  if (provider === "local_test") return environment === "development" ? localDevelopmentStore : null;
  const bucket = await getEvidenceBucket();
  // Local development has no R2 binding in a fresh checkout. Keep the
  // workflow testable in memory while staging and production still require
  // protected R2 through environment validation.
  if (!bucket && environment === "development" && (provider === "r2" || provider === "")) return localDevelopmentStore;
  if (!bucket) return null;
  return {
    put: async (key, value, options) => { await bucket.put(key, value, options); },
    get: async (key) => {
      const object = await bucket.get(key);
      const checksum = (object as unknown as { checksums?: { sha256?: ArrayBuffer } } | null)?.checksums?.sha256;
      return object ? {
        body: object.body,
        size: object.size,
        checksumSha256: checksum ? Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("") : undefined,
        arrayBuffer: () => object.arrayBuffer(),
      } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}

export async function getRecordingStore(): Promise<EvidenceStore | null> {
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  const provider = (await getRuntimeValue("RECORDING_STORAGE_PROVIDER") || "r2").toLowerCase();
  if (provider === "local_test") return environment === "development" ? localDevelopmentStore : null;
  const bucket = await getRecordingBucket();
  if (!bucket && environment === "development" && (provider === "livekit_r2" || provider === "r2" || provider === "")) return localDevelopmentStore;
  if (!bucket) return null;
  return {
    put: async (key, value, options) => { await bucket.put(key, value, options); },
    get: async (key) => {
      const object = await bucket.get(key);
      const checksum = (object as unknown as { checksums?: { sha256?: ArrayBuffer } } | null)?.checksums?.sha256;
      return object ? {
        body: object.body,
        size: object.size,
        checksumSha256: checksum ? Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("") : undefined,
        arrayBuffer: () => object.arrayBuffer(),
      } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}
