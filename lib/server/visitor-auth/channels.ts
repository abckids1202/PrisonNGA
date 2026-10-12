export type VisitorAuthChannel = "EMAIL" | "SMS";

export type VisitorAuthChannelPolicy = {
  channels: VisitorAuthChannel[];
  valid: boolean;
  emailOnly: boolean;
};

/**
 * Authentication is dual-channel by default. A deployment may explicitly
 * scope the pilot to email only, but that is a policy decision and must be
 * separately attested outside development before readiness can pass.
 */
export function parseVisitorAuthChannels(value: unknown): VisitorAuthChannelPolicy {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw || raw === "BOTH" || raw === "EMAIL,SMS" || raw === "SMS,EMAIL") {
    return { channels: ["EMAIL", "SMS"], valid: true, emailOnly: false };
  }
  if (raw === "EMAIL") return { channels: ["EMAIL"], valid: true, emailOnly: true };
  if (raw === "SMS") return { channels: ["SMS"], valid: true, emailOnly: false };
  return { channels: [], valid: false, emailOnly: false };
}

export function isVisitorAuthChannelEnabled(policy: VisitorAuthChannelPolicy, channel: VisitorAuthChannel): boolean {
  return policy.channels.includes(channel);
}
