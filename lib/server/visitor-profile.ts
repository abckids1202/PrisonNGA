import { SecurityError } from "./security";

export type VisitorProfileInput = {
  legalName: string;
  preferredName: string | null;
  phone: string | null;
};

export function parseVisitorProfileInput(body: { legalName?: unknown; preferredName?: unknown; phone?: unknown }): VisitorProfileInput {
  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const preferredName = typeof body.preferredName === "string" ? body.preferredName.trim() : null;
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;

  if (legalName.length < 2 || legalName.length > 160) throw new SecurityError("LEGAL_NAME_INVALID", 400);
  if (preferredName && preferredName.length > 120) throw new SecurityError("PREFERRED_NAME_INVALID", 400);
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new SecurityError("PHONE_FORMAT_INVALID", 400);

  return { legalName, preferredName: preferredName || null, phone: phone || null };
}
