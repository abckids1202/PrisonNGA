export type VisitorAuthChannel = "EMAIL" | "SMS";

export type VisitorAuthChannelPolicy = {
  channels: VisitorAuthChannel[];
  valid: boolean;
  emailOnly: boolean;
};

/**
 * Authentication is email-first by default. SMS is an explicit opt-in because
 * a missing deployment variable must not silently widen the authentication
 * surface or advertise a channel that has not passed provider and policy
 * review. Development/browser harnesses can opt into BOTH for dedicated SMS
 * coverage.
 */
export function parseVisitorAuthChannels(value: unknown): VisitorAuthChannelPolicy {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw || raw === "EMAIL") return { channels: ["EMAIL"], valid: true, emailOnly: true };
  if (raw === "BOTH" || raw === "EMAIL,SMS" || raw === "SMS,EMAIL") {
    return { channels: ["EMAIL", "SMS"], valid: true, emailOnly: false };
  }
  if (raw === "SMS") return { channels: ["SMS"], valid: true, emailOnly: false };
  return { channels: [], valid: false, emailOnly: false };
}

export function isVisitorAuthChannelEnabled(policy: VisitorAuthChannelPolicy, channel: VisitorAuthChannel): boolean {
  return policy.channels.includes(channel);
}
