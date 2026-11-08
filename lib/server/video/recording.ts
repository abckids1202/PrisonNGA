import { EncodedFileOutput, EncodedFileType, EgressClient, S3Upload } from "livekit-server-sdk";
import { getRuntimeValue, SecurityError } from "../security";

type RecordingStorageConfig = { endpoint: string; accessKey: string; secret: string; bucket: string; region: string };

async function recordingStorageConfig(): Promise<RecordingStorageConfig> {
  const provider = (await getRuntimeValue("RECORDING_STORAGE_PROVIDER") || "").trim().toLowerCase();
  const endpoint = (await getRuntimeValue("R2_S3_ENDPOINT") || "").trim();
  const accessKey = (await getRuntimeValue("R2_S3_ACCESS_KEY_ID") || "").trim();
  const secret = (await getRuntimeValue("R2_S3_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (await getRuntimeValue("R2_BUCKET_NAME") || "").trim();
  const region = (await getRuntimeValue("R2_S3_REGION") || "auto").trim();
  if (provider !== "livekit_r2" || !/^https:\/\//.test(endpoint) || !accessKey || !secret || !bucket) throw new SecurityError("RECORDING_STORAGE_NOT_CONFIGURED", 503);
  return { endpoint, accessKey, secret, bucket, region };
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
    output: { case: "s3", value: new S3Upload({ accessKey: storage.accessKey, secret: storage.secret, region: storage.region, endpoint: storage.endpoint, bucket: storage.bucket, forcePathStyle: true, contentDisposition: "private" }) },
  }), { layout: "grid" });
  if (!egress.egressId) throw new SecurityError("RECORDING_PROVIDER_REFERENCE_MISSING", 503);
  return { egressId: egress.egressId, storageKey: input.storageKey };
}
