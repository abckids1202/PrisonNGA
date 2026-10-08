import { isSecureHttpsEndpoint } from "./endpoint";

export type DeliveryChannel = "EMAIL" | "SMS";

export type DeliveryReadinessInput = {
  environment: string;
  delivery: string;
  channel: DeliveryChannel;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  resendApiKey?: string | null;
  emailFrom?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioFrom?: string | null;
  twilioMessagingServiceSid?: string | null;
};

/**
 * Returns whether one delivery channel can be used safely in the selected
 * environment. Keep this pure so readiness and provider setup tests cannot
 * drift apart.
 */
export function isDeliveryConfigured(input: DeliveryReadinessInput): boolean {
  const delivery = input.delivery.trim().toLowerCase();
  if (delivery === "in_app") return input.environment === "development";
  if (delivery === "webhook") return Boolean(input.webhookUrl && isSecureHttpsEndpoint(input.webhookUrl)) && Boolean(input.webhookSecret);
  if (delivery === "resend" && input.channel === "EMAIL") return Boolean(input.resendApiKey?.trim() && input.emailFrom?.trim());
  if (delivery === "twilio" && input.channel === "SMS") return Boolean(input.twilioAccountSid?.trim() && input.twilioAuthToken?.trim() && (input.twilioFrom?.trim() || input.twilioMessagingServiceSid?.trim()));
  return false;
}
