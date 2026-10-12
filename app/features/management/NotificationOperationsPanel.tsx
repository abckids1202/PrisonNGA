"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "../../components/ControlPrimitives";
import { formatDateValue as formatDateValueWithZone } from "@/lib/date-format";

type NoticeTone = "success" | "warning" | "error" | "info";
type NotificationDeliveryAttempt = { id: string; notification_id: string; channel: string; attempt_number: number; status: string; error_message: string | null; started_at: string; finished_at: string | null };
type OutboxFailure = { id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; payload: string; correlation_id: string; status: string; attempt_count: number; available_at: string; last_error: string | null; created_at: string; deliveryAttempts?: NotificationDeliveryAttempt[] };

function notificationAttemptSummary(event: OutboxFailure) {
  const attempts = event.deliveryAttempts || [];
  if (!attempts.length) return "No channel attempt records";
  const latestByChannel = new Map<string, NotificationDeliveryAttempt>();
  for (const attempt of attempts) {
    const current = latestByChannel.get(attempt.channel);
    if (!current || attempt.attempt_number > current.attempt_number) latestByChannel.set(attempt.channel, attempt);
  }
  return [...latestByChannel.values()].map((attempt) => `${attempt.channel}: ${attempt.status.replaceAll("_", " ").toLowerCase()}`).join(" · ");
}

export default function NotificationOperationsPanel({ onNotify }: { onNotify: (message: string, tone?: NoticeTone) => void }) {
  const [events, setEvents] = useState<OutboxFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replaying, setReplaying] = useState("");
  const load = () => { setLoading(true); fetch("/api/control/notifications/outbox", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } }).then(async (response) => { const body = await response.json() as { events?: OutboxFailure[]; error?: string }; if (!response.ok) throw new Error(body.error || "Unable to load notification failures"); setEvents(body.events || []); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load notification failures")).finally(() => setLoading(false)); };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const replay = async (event: OutboxFailure) => { setReplaying(event.id); try { const response = await fetch("/api/control/notifications/outbox", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `outbox-replay-${crypto.randomUUID()}` }, body: JSON.stringify({ outboxEventId: event.id, reason: "Staff requested retry of failed notification delivery." }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Unable to replay notification"); onNotify(`${event.event_type} queued for retry.`, "success"); load(); } catch (reason: unknown) { onNotify(reason instanceof Error ? reason.message : "Unable to replay notification", "error"); } finally { setReplaying(""); } };
  const formatDateValue = (value: string) => formatDateValueWithZone(value, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable");
  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Delivery exceptions</span><strong>{loading ? "—" : events.length}</strong><small>Facility-scoped failed and dead-letter events · replay is audited</small></div>{error ? <div className="sv3-settings-surface"><Status tone="red">UNAVAILABLE</Status><strong>Notification operations unavailable</strong><p>{error}</p><Button onClick={() => load()}>Try again</Button></div> : loading ? <div className="sv3-empty"><strong>Loading delivery exceptions</strong><p>Reading the persisted notification outbox.</p></div> : !events.length ? <div className="sv3-empty"><Status tone="green">CLEAR</Status><strong>No failed notifications</strong><p>The facility outbox has no failed or dead-letter deliveries requiring staff action.</p></div> : <div className="sv3-staff-list">{events.map((event) => <div className="sv3-notification-failure" key={event.id}><span><strong>{event.event_type}</strong><small>{event.aggregate_type} · {event.aggregate_id || "No aggregate"}</small></span><span><small>{event.attempt_count} attempt{event.attempt_count === 1 ? "" : "s"} · {formatDateValue(event.created_at)}</small><small>{event.last_error || "No delivery error recorded"}</small><small>{notificationAttemptSummary(event)}</small></span><Status tone={event.status === "DEAD_LETTER" ? "red" : "orange"}>{event.status}</Status><Button disabled={replaying === event.id} onClick={() => void replay(event)}>{replaying === event.id ? "Queueing…" : "Replay"}</Button></div>)}</div>}</div>;
}
