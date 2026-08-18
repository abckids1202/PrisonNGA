import { AccessToken, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";

export type ParticipantRole = "VISITOR" | "FACILITY" | "STAFF_OBSERVER";
export type VideoConfig = { provider: "livekit"; configured: boolean; url: string | null; apiKey: string | null; apiSecret: string | null };

export interface VideoProvider {
  createSession(roomName: string): Promise<{ roomName: string; roomSid: string | null }>;
  createParticipantToken(input: { roomName: string; identity: string; name: string; role: ParticipantRole }): Promise<string>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  endRoom(roomName: string): Promise<void>;
}

export async function getVideoConfig(): Promise<VideoConfig> {
  let values: Record<string, unknown> = {};
  try {
    const { env } = await import("cloudflare:workers");
    values = env as unknown as Record<string, unknown>;
  } catch {
    values = typeof process !== "undefined" ? process.env as Record<string, unknown> : {};
  }
  const provider = String(values.VIDEO_PROVIDER || "livekit").toLowerCase();
  const url = typeof values.LIVEKIT_URL === "string" ? values.LIVEKIT_URL : null;
  const apiKey = typeof values.LIVEKIT_API_KEY === "string" ? values.LIVEKIT_API_KEY : null;
  const apiSecret = typeof values.LIVEKIT_API_SECRET === "string" ? values.LIVEKIT_API_SECRET : null;
  return { provider: "livekit", configured: provider === "livekit" && Boolean(url && apiKey && apiSecret), url, apiKey, apiSecret };
}

export function createProviderRoomName(): string {
  return `sv_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function createLiveKitProvider(): Promise<VideoProvider> {
  const config = await getVideoConfig();
  if (!config.configured || !config.url || !config.apiKey || !config.apiSecret) throw new Error("VIDEO_PROVIDER_NOT_CONFIGURED");
  return new LiveKitVideoProvider(config);
}

class LiveKitVideoProvider implements VideoProvider {
  private readonly service: RoomServiceClient;
  private readonly config: VideoConfig;

  constructor(config: VideoConfig) {
    this.config = config;
    const serviceUrl = config.url!.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    this.service = new RoomServiceClient(serviceUrl, config.apiKey!, config.apiSecret!);
  }

  async createSession(roomName: string) {
    const room = await this.service.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 90, maxParticipants: 3 });
    return { roomName, roomSid: room.sid || null };
  }

  async createParticipantToken(input: { roomName: string; identity: string; name: string; role: ParticipantRole }) {
    const grant: VideoGrant = {
      roomJoin: true,
      room: input.roomName,
      canSubscribe: true,
      canPublish: input.role !== "STAFF_OBSERVER",
      canPublishData: input.role !== "STAFF_OBSERVER",
      roomAdmin: false,
    };
    const token = new AccessToken(this.config.apiKey!, this.config.apiSecret!, { identity: input.identity, name: input.name, ttl: "10m", metadata: JSON.stringify({ role: input.role }) });
    token.addGrant(grant);
    return token.toJwt();
  }

  async removeParticipant(roomName: string, identity: string) {
    await this.service.removeParticipant(roomName, identity);
  }

  async endRoom(roomName: string) {
    await this.service.deleteRoom(roomName);
  }
}
