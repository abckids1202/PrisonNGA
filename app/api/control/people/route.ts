import { getD1 } from "../../../../db/runtime";
import { peopleDirectoryCountsStatement, pendingRelationshipDirectoryStatement, visitorDirectoryStatement } from "../../../../lib/server/people-directory";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("visitor.directory.read");
    const d1 = await getD1();
    const [visitors, relationships, counts] = await Promise.all([
      visitorDirectoryStatement(d1, authorization.facilityId, new Date().toISOString()).all(),
      pendingRelationshipDirectoryStatement(d1, authorization.facilityId).all(),
      peopleDirectoryCountsStatement(d1, authorization.facilityId).first<{ visitors: number; prisoners: number; awaiting_verification: number; relationship_requests: number }>(),
    ]);
    const rows = visitors.results || [];
    return securityResponse({
      facilityId: authorization.facilityId,
      visitors: rows,
      relationships: relationships.results || [],
      counts: {
        visitors: Number(counts?.visitors || 0),
        prisoners: Number(counts?.prisoners || 0),
        awaitingVerification: Number(counts?.awaiting_verification || 0),
        relationshipRequests: Number(counts?.relationship_requests || 0),
      },
      truncated: rows.length === 250 || (relationships.results || []).length === 250,
    }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
