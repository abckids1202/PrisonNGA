import { getEvidenceBucket } from "../../db/runtime";
import { getRuntimeValue } from "./security";

export type EvidenceObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
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
    return {
      body: new Response(copy).body!,
      size: copy.byteLength,
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
  if (!bucket) return null;
  return {
    put: async (key, value, options) => { await bucket.put(key, value, options); },
    get: async (key) => {
      const object = await bucket.get(key);
      return object ? { body: object.body, size: object.size, arrayBuffer: () => object.arrayBuffer() } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}
