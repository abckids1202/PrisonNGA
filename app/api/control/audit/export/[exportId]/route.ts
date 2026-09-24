import { getD1 } from "../../../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

/**
 * Returns the immutable metadata recorded when a scoped audit CSV was created.
 * The CSV itself is intentionally not regenerated here: the manifest digest is
 * the stable integrity reference for the exact downloaded artifact.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const { exportId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new SecurityError("INVALID_AUDIT_EXPORT_ID", 400);
    const d1 = await getD1();
    const manifest = await d1.prepare(`SELECT id, facility_id, requested_by, sha256, row_count, from_at, to_at, created_at
      FROM audit_export_manifests WHERE id = ? AND facility_id = ?`).bind(exportId, authorization.facilityId).first<{
        id: string;
        facility_id: string;
        requested_by: string;
        sha256: string;
        row_count: number;
        from_at: string | null;
        to_at: string | null;
        created_at: string;
      }>();
    if (!manifest) throw new SecurityError("AUDIT_EXPORT_NOT_FOUND", 404);
    return securityResponse({
      manifest,
      integrity: {
        algorithm: "SHA-256",
        status: "MANIFEST_RECORDED",
        verification: "Compare the downloaded artifact SHA-256 digest with manifest.sha256.",
      },
    }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
