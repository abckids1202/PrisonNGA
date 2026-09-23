type KioskCredentialDatabase = Pick<D1Database, "prepare">;

export type AuthenticatedKiosk = { resourceId: string; facilityId: string };

export function createKioskCredentialSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function hashKioskCredential(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authenticateKiosk(
  database: KioskCredentialDatabase,
  request: Request,
  options: { touchLastUsed?: boolean } = {},
): Promise<AuthenticatedKiosk | null> {
  const resourceId = request.headers.get("x-securevisit-kiosk-id")?.trim() || "";
  const secret = request.headers.get("x-securevisit-kiosk-token")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{3,80}$/u.test(resourceId) || !/^[A-Za-z0-9_-]{40,60}$/u.test(secret)) {
    return null;
  }

  const credentialHash = await hashKioskCredential(secret);
  const credential = await database.prepare(`SELECT kc.resource_id, kc.facility_id, kc.id
    FROM kiosk_credentials kc
    INNER JOIN resources r ON r.id = kc.resource_id AND r.facility_id = kc.facility_id
    WHERE kc.resource_id = ? AND kc.credential_hash = ? AND kc.status = 'ACTIVE'
      AND r.resource_type = 'DEVICE' AND r.status = 'ONLINE'`)
    .bind(resourceId, credentialHash)
    .first<{ id: string; resource_id: string; facility_id: string }>();

  if (!credential) return null;
  if (options.touchLastUsed !== false) {
    const touched = await database.prepare("UPDATE kiosk_credentials SET last_used_at = ? WHERE id = ? AND status = 'ACTIVE'")
      .bind(new Date().toISOString(), credential.id)
      .run();
    if (!touched.meta.changes) return null;
  }
  return { resourceId: credential.resource_id, facilityId: credential.facility_id };
}
