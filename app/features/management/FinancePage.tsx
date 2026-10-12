"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Metric, PageHeader, Status } from "../../components/ControlPrimitives";
import { formatDateValue as formatDateValueWithZone } from "@/lib/date-format";

type NoticeTone = "success" | "warning" | "error" | "info";

type FinanceRecord = { id: string; appointment_id?: string | null; entry_type?: string; amount?: number; created_at: string; visitor_name?: string; credit_quantity?: number; amount_minor?: number; currency?: string; status?: string; refund_request_id?: string | null; refund_status?: string | null; refund_reason?: string | null };
type FinancePayload = { summary: { credits_purchased?: number; credits_consumed?: number; credits_reserved?: number; refund_cases?: number; pending_payments?: number; settled_amount_minor?: number; last_ledger_activity?: string | null }; ledger: FinanceRecord[]; payments: FinanceRecord[]; providerConfigured: boolean; reconciliation: { available: boolean; workerConfigured?: boolean; issueCount?: number; issues?: Array<{ issue_type: string; payment_intent_id: string | null; provider_event_id: string | null; detail: string }>; reason?: string } };
type PaymentRecoveryEvent = { id: string; provider: string; event_key: string; event_type: string; status: string; attempt_count: number; available_at: string | null; last_error: string | null; created_at: string; payment_intent_id: string; payment_status: string };

export default function FinancePage({ timeZone, onNotify }: { timeZone: string; onNotify: (message: string, tone?: NoticeTone) => void }) {
  const formatDateValue = (value: string | Date, options: Intl.DateTimeFormatOptions, _unusedTimeZone?: string, fallback = "—") => formatDateValueWithZone(value, options, timeZone, fallback);
  const [tab, setTab] = useState("Overview");
  const [data, setData] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recoveryEvents, setRecoveryEvents] = useState<PaymentRecoveryEvent[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [replayingEvent, setReplayingEvent] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("Provider event requires a controlled finance retry after operational review.");
  const [refundPayment, setRefundPayment] = useState<FinanceRecord | null>(null);
  const [refundReason, setRefundReason] = useState("Refund approved after facility review.");
  const [refundBusy, setRefundBusy] = useState(false);
  const load = useCallback(async (): Promise<FinancePayload | null> => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/control/finance", { cache: "no-store" });
      const body = await response.json() as FinancePayload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to load financial records.");
      setData(body);
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load financial records.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const loadRecoveryEvents = useCallback(async () => {
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const response = await fetch("/api/control/finance/payment-events", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } });
      const body = await response.json() as { events?: PaymentRecoveryEvent[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to load payment recovery events.");
      setRecoveryEvents(body.events || []);
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : "Unable to load payment recovery events.");
    } finally {
      setRecoveryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab !== "Reconciliation") return;
    const timer = window.setTimeout(() => { void loadRecoveryEvents(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRecoveryEvents, tab]);
  const summary = data?.summary || {};
  const formatMoney = (minor: number | undefined) => minor === undefined ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(minor));
  const formatDate = (value?: string | null) => value ? formatDateValue(value, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable") : "No recorded activity";
  const statusTone = (status: string) => ["SUCCEEDED", "REFUNDED"].includes(status) ? "green" : ["FAILED", "DISPUTED"].includes(status) ? "red" : "orange";
  const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const ledger = data?.ledger || [];
  const payments = tab === "Refunds" ? (data?.payments || []).filter((payment) => Boolean(payment.refund_status) || ["REFUNDED", "DISPUTED"].includes(String(payment.status))) : data?.payments || [];
  const noData = loading ? "Loading persisted financial records…" : error || "No records have been persisted for this facility.";
  const runChecks = async () => {
    const refreshed = await load();
    const issueCount = refreshed?.reconciliation.issueCount || 0;
    onNotify(issueCount ? `${issueCount} reconciliation issue${issueCount === 1 ? "" : "s"} found. Provider actions still require review.` : "Reconciliation data refreshed with no recorded issues.", issueCount ? "warning" : "success");
  };
  const replayPaymentEvent = async (event: PaymentRecoveryEvent) => {
    if (recoveryReason.trim().length < 8) {
      onNotify("Add a specific finance recovery reason before replaying the event.", "warning");
      return;
    }
    setReplayingEvent(event.id);
    try {
      const response = await fetch("/api/control/finance/payment-events", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `payment-event-replay-${event.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ paymentEventId: event.id, reason: recoveryReason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to replay payment provider event.");
      onNotify(`${event.event_type} returned to the payment worker queue.`, "success");
      await Promise.all([loadRecoveryEvents(), load()]);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "Unable to replay payment provider event.", "warning");
    } finally {
      setReplayingEvent("");
    }
  };
  const requestRefund = async () => {
    if (!refundPayment || refundReason.trim().length < 8) {
      onNotify("Add a specific refund reason before requesting a refund.", "warning");
      return;
    }
    setRefundBusy(true);
    try {
      const response = await fetch("/api/control/finance/refunds", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `finance-refund-${refundPayment.id}-${crypto.randomUUID()}` },
        body: JSON.stringify({ paymentIntentId: refundPayment.id, reason: refundReason.trim() }),
      });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok) {
        if (body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID") throw new Error("A fresh supervisor step-up check is required before requesting a refund. No payment was changed.");
        throw new Error(body.error || "The refund request could not be created.");
      }
      setRefundPayment(null);
      onNotify(`Refund request ${body.status === "COMPLETED" ? "is already completed" : "was sent to the provider"}. Settlement remains webhook-driven.`, "success");
      await load();
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "The refund request could not be created.", "warning");
    } finally {
      setRefundBusy(false);
    }
  };
  return <>
    <PageHeader eyebrow="Management · Financial controls" title="Finance" description="Facility-scoped credits, payment intents, and the append-only ledger." actions={<Button variant="primary" disabled={!data?.reconciliation.available || loading} onClick={() => void runChecks()}>{loading ? "Refreshing…" : "Run checks"}</Button>} />
    <div className="sv3-finance-tabs">{["Overview", "Ledger", "Payments", "Refunds", "Reconciliation"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {!loading && error ? <div className="sv3-settings-surface"><strong>Financial records unavailable</strong><p>{error}</p></div> : null}
    {tab === "Overview" ? <div className="sv3-finance-overview">
      <div className="sv3-finance-metrics"><Metric label="Credits purchased" value={data ? String(summary.credits_purchased ?? 0) : "—"} detail="Persisted ledger total" tone="green" /><Metric label="Credits consumed" value={data ? String(summary.credits_consumed ?? 0) : "—"} detail="Settled visit usage" tone="blue" /><Metric label="Credits reserved" value={data ? String(summary.credits_reserved ?? 0) : "—"} detail="Current account reservations" tone="orange" /><Metric label="Refund cases" value={data ? String(summary.refund_cases ?? 0) : "—"} detail={`${summary.pending_payments ?? 0} payment intents pending`} tone="red" /></div>
      <div className="sv3-finance-lower"><section className="sv3-surface sv3-ledger-preview"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Append-only ledger</span><h2>Recent activity</h2></div><button className="sv3-link-button" onClick={() => setTab("Ledger")}>Open ledger →</button></div>{ledger.length ? ledger.slice(0, 5).map((row) => <div className="sv3-ledger-row" key={row.id}><time>{formatDateValue(row.created_at, { hour: "2-digit", minute: "2-digit" }, undefined, "—")}</time><span><strong>{label(String(row.entry_type))}</strong><small>{row.visitor_name || "Visitor unavailable"}{row.appointment_id ? ` · ${row.appointment_id}` : ""}</small></span><span>{row.amount === undefined ? "—" : `${row.amount > 0 ? "+" : ""}${row.amount} credit${Math.abs(row.amount) === 1 ? "" : "s"}`}</span><Status tone="green">RECORDED</Status></div>) : <div className="sv3-empty"><strong>{noData}</strong></div>}</section><aside className="sv3-reconcile-card"><span className="sv3-eyebrow">Reconciliation</span><strong>{data?.reconciliation.available ? "Available" : "Not configured"}</strong><p>{data?.reconciliation.available ? "A controlled reconciliation worker is available." : "No reconciliation worker is configured. No success state is being inferred from UI data."}</p><small>Last ledger activity · {formatDate(summary.last_ledger_activity)}</small></aside></div>
     </div> : <div className="sv3-finance-tab-content"><div className="sv3-finance-tab-head"><div><span className="sv3-eyebrow">{tab}</span><h2>{tab === "Ledger" ? "Credit ledger" : tab === "Refunds" ? "Refund cases" : tab === "Payments" ? "Provider transactions" : "Control checks"}</h2></div><span className="sv3-toolbar-meta">{data ? `${data.providerConfigured ? "Provider configured" : "Provider not configured"} · facility scope` : "Loading facility scope…"}</span></div>{tab === "Reconciliation" ? <div className="sv3-control-checks"><ControlCheck label="Credit ledger" detail={data ? `${ledger.length} recent entries loaded from D1` : noData} /><ControlCheck label="Payment provider" detail={data?.providerConfigured ? "Configured for this environment" : "Not configured; checkout cannot be treated as real money"} warning={!data?.providerConfigured} /><ControlCheck label="Settlement" detail={data ? `${formatMoney(summary.settled_amount_minor)} in succeeded payment intents` : noData} /><ControlCheck label="Worker" detail={data?.reconciliation.workerConfigured ? "Scheduled reconciliation worker is configured" : "No reconciliation worker is configured"} warning={!data?.reconciliation.workerConfigured} />{data?.reconciliation.issues?.length ? <section className="sv3-settings-surface"><strong>Open reconciliation issues</strong>{data.reconciliation.issues.map((issue) => <p key={`${issue.issue_type}-${issue.payment_intent_id || issue.provider_event_id || "unknown"}`}><b>{label(issue.issue_type)}</b> · {issue.detail}</p>)}</section> : null}<section className="sv3-settings-surface" aria-labelledby="payment-recovery-title"><div className="sv3-rule-line"><div><strong id="payment-recovery-title">Provider event recovery</strong><small>Failed and dead-lettered events are requeued only after finance review. Replay never settles money directly.</small></div><button className="sv3-button" onClick={() => void loadRecoveryEvents()} disabled={recoveryLoading}>{recoveryLoading ? "Refreshing…" : "Refresh"}</button></div><label className="sv3-policy-reason">Recovery reason<textarea value={recoveryReason} maxLength={500} onChange={(event) => setRecoveryReason(event.target.value)} /></label>{recoveryError ? <p className="sv3-policy-feedback error" role="alert">{recoveryError}</p> : recoveryLoading ? <div className="sv3-empty"><strong>Loading provider recovery events</strong><p>Reading failed and dead-lettered payment events.</p></div> : recoveryEvents.length ? <div className="sv3-staff-list">{recoveryEvents.map((event) => <div className="sv3-notification-failure" key={event.id}><span><strong>{label(event.event_type)}</strong><small>{event.provider} · {event.payment_intent_id}</small></span><span><small>{event.attempt_count} attempt{event.attempt_count === 1 ? "" : "s"} · {formatDate(event.created_at)}</small><small>{event.last_error || "No provider error recorded"}</small></span><Status tone={event.status === "DEAD_LETTER" ? "red" : "orange"}>{label(event.status)}</Status><button className="sv3-button" onClick={() => void replayPaymentEvent(event)} disabled={replayingEvent === event.id || recoveryReason.trim().length < 8}>{replayingEvent === event.id ? "Queueing…" : "Replay · step-up"}</button></div>)}</div> : <div className="sv3-empty"><Status tone="green">CLEAR</Status><strong>No failed payment events</strong><p>Provider failures will appear here for controlled, audited recovery.</p></div>}</section></div> : <div className="sv3-finance-table">{payments.length ? payments.map((row) => { const refundStatus = row.refund_status || row.status || ""; const canRequest = tab === "Payments" && row.status === "SUCCEEDED" && !row.refund_status; const canRetry = tab === "Refunds" && row.refund_status === "FAILED"; return <div className="sv3-finance-payment-row" key={row.id}><button type="button" onClick={() => onNotify(`${row.id} is a persisted payment record.`)}><strong>{row.id}</strong><span>{row.visitor_name || "Visitor unavailable"}</span><span>{row.credit_quantity || 0} Visit Credit{row.credit_quantity === 1 ? "" : "s"}</span><span>{tab === "Refunds" ? label(refundStatus) : formatMoney(row.amount_minor)}</span><Status tone={statusTone(refundStatus)}>{label(refundStatus)}</Status><b>→</b></button>{canRequest ? <Button variant="quiet" disabled={!data?.providerConfigured} onClick={() => { setRefundPayment(row); setRefundReason("Refund approved after facility review."); }}>{data?.providerConfigured ? "Request refund" : "Provider unavailable"}</Button> : canRetry ? <Button variant="quiet" onClick={() => { setRefundPayment(row); setRefundReason(row.refund_reason || "Retry refund after facility review."); }}>Retry refund</Button> : row.refund_status === "REQUESTED" ? <span className="sv3-toolbar-meta">Awaiting provider</span> : null}</div>; }) : <div className="sv3-empty"><strong>{noData}</strong></div>}</div>}</div>}
     {refundPayment ? <div className="sv3-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !refundBusy) setRefundPayment(null); }}><section className="sv3-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-refund-title"><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">Finance · controlled action</span><h2 id="finance-refund-title">Request refund</h2><p>This creates an audited provider refund request. Credits are reversed only after the signed provider webhook confirms settlement.</p></div><button type="button" onClick={() => setRefundPayment(null)} disabled={refundBusy} aria-label="Close refund dialog">×</button></div><div className="sv3-settings-surface"><strong>{refundPayment.id}</strong><p>{refundPayment.visitor_name || "Visitor unavailable"} · {refundPayment.credit_quantity || 0} Visit Credit · {formatMoney(refundPayment.amount_minor)}</p></div><label className="sv3-dialog-field">Reason<textarea minLength={8} maxLength={500} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} /></label><p className="sv3-policy-feedback">A fresh supervisor step-up is required. The payment remains unchanged if that check fails.</p><div className="sv3-dialog-actions"><Button variant="quiet" onClick={() => setRefundPayment(null)} disabled={refundBusy}>Cancel</Button><Button variant="danger" onClick={() => void requestRefund()} disabled={refundBusy || refundReason.trim().length < 8}>{refundBusy ? "Requesting…" : "Request provider refund"}</Button></div></section></div> : null}
  </>;
}
function ControlCheck({ label, detail, warning = false }: { label: string; detail: string; warning?: boolean }) {
  return <div className={`sv3-control-check ${warning ? "warning" : ""}`}><span>{warning ? "!" : "✓"}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{warning ? "Review" : "Passed"}</b></div>;
}


