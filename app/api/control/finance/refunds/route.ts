import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { getPaymentProvider } from "../../../../../lib/server/payments/provider";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("finance.manage");
    const body = await request.json() as { paymentIntentId?: unknown; reason?: unknown };
    const paymentIntentId = typeof body.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!paymentIntentId || !/^[A-Za-z0-9._:-]{8,128}$/.test(paymentIntentId)) throw new SecurityError("PAYMENT_INTENT_REQUIRED", 400);
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);

    d1 = await getD1();
    const intent = await d1.prepare("SELECT id, facility_id, provider, provider_reference, amount_minor, currency, status FROM payment_intents WHERE id = ? AND facility_id = ? LIMIT 1")
      .bind(paymentIntentId, authorization.facilityId)
      .first<{ id: string; facility_id: string; provider: string; provider_reference: string | null; amount_minor: number; currency: string; status: string }>();
    if (!intent) throw new SecurityError("PAYMENT_INTENT_NOT_FOUND", 404);
    if (intent.status !== "SUCCEEDED" || !intent.provider_reference) throw new SecurityError("PAYMENT_NOT_REFUNDABLE", 409);
    const payload = { paymentIntentId, reason };
    await requireStepUp({ purpose: "payment_refund", userId: authorization.userId, targetId: paymentIntentId, payload });

    const scope = `finance-refund:${authorization.facilityId}:${paymentIntentId}`;
    const requestHash = await hashIdempotencyPayload(payload);
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };

    const existing = await d1.prepare("SELECT id, status, provider_reference, amount_minor, currency FROM payment_refund_requests WHERE payment_intent_id = ? AND facility_id = ? AND status IN ('REQUESTED', 'COMPLETED') ORDER BY created_at DESC LIMIT 1")
      .bind(paymentIntentId, authorization.facilityId).first<{ id: string; status: string; provider_reference: string | null; amount_minor: number; currency: string }>();
    if (existing) throw new SecurityError("PAYMENT_REFUND_ALREADY_REQUESTED", 409);
    const provider = await getPaymentProvider();
    if (!provider) throw new SecurityError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);

    const refundRequestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await d1.batch([
      d1.prepare("INSERT INTO payment_refund_requests (id, facility_id, payment_intent_id, requested_by, provider, amount_minor, currency, reason, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?)")
        .bind(refundRequestId, authorization.facilityId, paymentIntentId, authorization.userId, intent.provider, intent.amount_minor, intent.currency, reason, idempotencyKey, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "PAYMENT_REFUND_REQUESTED", entityType: "payment_refund_request", entityId: refundRequestId, reason, newValues: { paymentIntentId, amountMinor: intent.amount_minor, currency: intent.currency, status: "REQUESTED" }, requestId: context.requestId, correlationId, eventType: "PAYMENT_REFUND_REQUESTED", payload: { refundRequestId, paymentIntentId, amountMinor: intent.amount_minor, currency: intent.currency } }),
    ]);
    if (!created[0]?.meta.changes) throw new SecurityError("PAYMENT_REFUND_REQUEST_CONFLICT", 409);

    let providerRefund;
    try {
      providerRefund = await provider.requestRefund({ paymentIntentId, providerReference: intent.provider_reference, amountMinor: intent.amount_minor, currency: intent.currency, reason });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 240) : "PAYMENT_REFUND_REQUEST_FAILED";
      await d1.batch([
        d1.prepare("UPDATE payment_refund_requests SET status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'REQUESTED'").bind(new Date().toISOString(), refundRequestId),
        ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "PAYMENT_REFUND_FAILED", entityType: "payment_refund_request", entityId: refundRequestId, reason: "Payment provider refund request failed.", oldValues: { status: "REQUESTED" }, newValues: { status: "FAILED", error: message }, requestId: context.requestId, correlationId, eventType: "PAYMENT_REFUND_FAILED", payload: { refundRequestId, paymentIntentId, error: message } }, { sql: "EXISTS (SELECT 1 FROM payment_refund_requests WHERE id = ? AND status = 'FAILED')", values: [refundRequestId] }),
      ]);
      await releaseIdempotencyClaim(d1, idempotency);
      idempotency = null;
      throw error;
    }

    await d1.batch([
      d1.prepare("UPDATE payment_refund_requests SET provider_reference = ?, updated_at = ? WHERE id = ? AND status = 'REQUESTED'").bind(providerRefund.providerReference, new Date().toISOString(), refundRequestId),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "PAYMENT_REFUND_PROVIDER_ACCEPTED", entityType: "payment_refund_request", entityId: refundRequestId, reason: "Payment provider accepted the refund request; settlement remains webhook-driven.", newValues: { status: "REQUESTED", providerReference: providerRefund.providerReference }, requestId: context.requestId, correlationId, eventType: "PAYMENT_REFUND_PROVIDER_ACCEPTED", payload: { refundRequestId, paymentIntentId, providerReference: providerRefund.providerReference } }, { sql: "EXISTS (SELECT 1 FROM payment_refund_requests WHERE id = ? AND status = 'REQUESTED')", values: [refundRequestId] }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 202, body: { refundRequestId, paymentIntentId, status: "REQUESTED", providerReference: providerRefund.providerReference, correlationId }, guard: { sql: "EXISTS (SELECT 1 FROM payment_refund_requests WHERE id = ? AND status = 'REQUESTED')", values: [refundRequestId] } }),
    ]);
    return securityResponse({ refundRequestId, paymentIntentId, status: "REQUESTED", providerReference: providerRefund.providerReference, correlationId }, 202, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original finance error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
