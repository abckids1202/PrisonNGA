import { EncodedFileOutput, EncodedFileType, EgressClient, S3Upload, ServerError } from "livekit-server-sdk";
import { getRuntimeValue, SecurityError } from "../security";
import { isSafeRecordingEncryptionReference } from "../recording-config";

type RecordingStorageConfig = { endpoint: string; accessKey: string; secret: string; bucket: string; region: string; encryptionKeyReference: string };

async function recordingStorageConfig(): Promise<RecordingStorageConfig> {
  const provider = (await getRuntimeValue("RECORDING_STORAGE_PROVIDER") || "").trim().toLowerCase();
  const endpoint = (await getRuntimeValue("R2_S3_ENDPOINT") || "").trim();
  const accessKey = (await getRuntimeValue("R2_S3_ACCESS_KEY_ID") || "").trim();
  const secret = (await getRuntimeValue("R2_S3_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (await getRuntimeValue("RECORDINGS_BUCKET_NAME") || await getRuntimeValue("R2_BUCKET_NAME") || "").trim();
  const region = (await getRuntimeValue("R2_S3_REGION") || "auto").trim();
  const encryptionMode = (await getRuntimeValue("RECORDINGS_ENCRYPTION_MODE") || "").trim().toLowerCase();
  const encryptionKeyReference = (await getRuntimeValue("RECORDINGS_ENCRYPTION_KEY_REFERENCE") || "").trim();
  if (provider !== "livekit_r2" || encryptionMode !== "r2_managed" || !/^https:\/\//.test(endpoint) || !accessKey || !secret || !bucket || !isSafeRecordingEncryptionReference(encryptionKeyReference)) throw new SecurityError("RECORDING_STORAGE_NOT_CONFIGURED", 503);
  return { endpoint, accessKey, secret, bucket, region, encryptionKeyReference };
}

export async function startLiveKitRecording(input: { liveKitUrl: string; apiKey: string; apiSecret: string; roomName: string; storageKey: string }) {
  const storage = await recordingStorageConfig();
  const host = input.liveKitUrl.startsWith("wss://") ? `https://${input.liveKitUrl.slice("wss://".length)}` : input.liveKitUrl.replace(/^ws:\/\//, "http://");
  if (!/^https:\/\//.test(host)) throw new SecurityError("VIDEO_PROVIDER_URL_INVALID", 503);
  const client = new EgressClient(host, input.apiKey, input.apiSecret, { requestTimeout: 15_000 });
  const egress = await client.startRoomCompositeEgress(input.roomName, new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: input.storageKey,
    disableManifest: true,
    output: { case: "s3", value: new S3Upload({
      accessKey: storage.accessKey,
      secret: storage.secret,
      region: storage.region,
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      forcePathStyle: true,
      contentDisposition: "private",
      // R2 provides encryption at rest; retain the non-secret control
      // reference on the object so storage/recovery operators can prove that
      // the egress output used the governed encryption policy without
      // exposing key material to D1, logs, or playback clients.
      metadata: {
        "securevisit-encryption-control": storage.encryptionKeyReference,
        "securevisit-privacy": "private",
      },
    }) },
  }), { layout: "grid" });
  if (!egress.egressId) throw new SecurityError("RECORDING_PROVIDER_REFERENCE_MISSING", 503);
  return { egressId: egress.egressId, storageKey: input.storageKey };
}

export async function stopLiveKitRecording(input: { liveKitUrl: string; apiKey: string; apiSecret: string; egressId: string }) {
  const host = input.liveKitUrl.startsWith("wss://") ? `https://${input.liveKitUrl.slice("wss://".length)}` : input.liveKitUrl.replace(/^ws:\/\//, "http://");
  if (!/^https:\/\//.test(host)) throw new SecurityError("VIDEO_PROVIDER_URL_INVALID", 503);
  const client = new EgressClient(host, input.apiKey, input.apiSecret, { requestTimeout: 15_000 });
  try {
    await client.stopEgress(input.egressId);
  } catch (error) {
    // A retry can race the provider callback or a previous successful stop.
    // Treat only an authoritative missing-egress response as success; all
    // other provider failures must keep the session in reconciliation.
    if (error instanceof ServerError && ["not_found", "egress_not_found"].includes(error.code || "")) return;
    throw error;
  }
}
