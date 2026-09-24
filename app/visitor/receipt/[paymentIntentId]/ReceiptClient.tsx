"use client";

import { useEffect, useState } from "react";
import "../../visitor-auth.css";

type Receipt = {
  receiptId: string;
  paymentIntentId: string;
  facilityName: string;
  provider: string;
  providerReference: string | null;
  creditQuantity: number;
  amountMinor: number;
  currency: string;
  status: string;
  issuedAt: string;
};

export default function ReceiptClient({ paymentIntentId }: { paymentIntentId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/visitor/payments/${encodeURIComponent(paymentIntentId)}/receipt`, { credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { receipt?: Receipt; error?: string };
        if (!response.ok || !body.receipt) throw new Error(body.error || "This receipt is not available.");
        setReceipt(body.receipt);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This receipt is not available."));
  }, [paymentIntentId]);

  if (error) return <main className="sv4-receipt-page"><section className="sv4-receipt-card"><p className="sv4-kicker">SecureVisit</p><h1>Receipt unavailable</h1><p>{error.replaceAll("_", " ")}</p><a className="sv4-button sv4-button-primary" href="/visitor/credits">Back to credits</a></section></main>;
  if (!receipt) return <main className="sv4-receipt-page"><section className="sv4-receipt-card"><p className="sv4-kicker">SecureVisit</p><h1>Preparing your receipt…</h1><p>Checking the confirmed payment record.</p></section></main>;
  const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: receipt.currency, maximumFractionDigits: 0 });
  return <main className="sv4-receipt-page"><section className="sv4-receipt-card" aria-labelledby="receipt-title"><div className="sv4-receipt-top"><div><p className="sv4-kicker">SecureVisit · Payment receipt</p><h1 id="receipt-title">Payment confirmed</h1></div><span className="sv4-receipt-check">✓</span></div><p className="sv4-receipt-lead">Your Visit Credits are ready to use for an approved visit.</p><dl className="sv4-receipt-details"><div><dt>Receipt</dt><dd>{receipt.receiptId}</dd></div><div><dt>Facility</dt><dd>{receipt.facilityName}</dd></div><div><dt>Visit Credits</dt><dd>{receipt.creditQuantity}</dd></div><div><dt>Amount paid</dt><dd>{currency.format(receipt.amountMinor)}</dd></div><div><dt>Confirmed</dt><dd>{new Date(receipt.issuedAt).toLocaleString("id-ID")}</dd></div><div><dt>Payment reference</dt><dd>{receipt.providerReference || "—"}</dd></div></dl><div className="sv4-receipt-actions"><button className="sv4-button sv4-button-primary" type="button" onClick={() => window.print()}>Print receipt</button><a className="sv4-button" href="/visitor/credits">Back to credits</a></div></section></main>;
}
