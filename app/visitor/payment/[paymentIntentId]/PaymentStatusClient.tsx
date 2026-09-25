"use client";

import { useEffect, useState } from "react";

type Payment = { id: string; status: string; creditQuantity: number; amountMinor: number; currency: string; checkoutUrl: string | null; settled: boolean; updatedAt: string | null };

function label(status: string): string {
  return ({ SUCCEEDED: "Payment confirmed", CHECKOUT_CREATED: "Payment is processing", PENDING: "Preparing payment", FAILED: "Payment failed", EXPIRED: "Checkout expired", REFUNDED: "Payment refunded", DISPUTED: "Payment under review" } as Record<string, string>)[status] || "Payment status";
}

export default function PaymentStatusClient({ paymentIntentId }: { paymentIntentId: string }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState("");
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/visitor/payments/${encodeURIComponent(paymentIntentId)}`, { credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { paymentIntent?: Payment; error?: string };
        if (!response.ok || !body.paymentIntent) throw new Error(body.error || "Payment status is unavailable.");
        if (active) { setPayment(body.paymentIntent); setError(""); }
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Payment status is unavailable."));
    return () => { active = false; };
  }, [paymentIntentId, polls]);

  useEffect(() => {
    if (!payment || !["PENDING", "CHECKOUT_CREATED"].includes(payment.status) || polls >= 12) return;
    const timer = window.setTimeout(() => setPolls((value) => value + 1), 5_000);
    return () => window.clearTimeout(timer);
  }, [payment, polls]);

  return <main className="sv4-receipt-page"><section className="sv4-receipt-card" aria-live="polite"><p className="sv4-kicker">SecureVisit · Payment status</p><h1>{error ? "Payment status unavailable" : label(payment?.status || "PENDING")}</h1>{error ? <p>{error}</p> : payment ? <><p>Your credit balance changes only after SecureVisit receives and verifies the provider confirmation.</p><dl className="sv4-receipt-details"><div><dt>Visit Credits</dt><dd>{payment.creditQuantity}</dd></div><div><dt>Reference</dt><dd>{payment.id}</dd></div><div><dt>State</dt><dd>{payment.status}</dd></div></dl>{payment.status === "SUCCEEDED" && payment.settled ? <a className="sv4-button sv4-button-primary" href={`/visitor/receipt/${encodeURIComponent(payment.id)}`}>View receipt</a> : payment.checkoutUrl && payment.status === "CHECKOUT_CREATED" ? <a className="sv4-button sv4-button-primary" href={payment.checkoutUrl}>Return to checkout</a> : <p className="sv4-request-hint">This page checks for provider confirmation for up to one minute. You can safely return to Credits.</p>}</> : <p>Checking the payment record…</p>}<a className="sv4-button" href="/visitor/credits">Back to credits</a></section></main>;
}
