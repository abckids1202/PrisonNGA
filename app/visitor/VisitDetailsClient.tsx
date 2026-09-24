"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getVisitorVisitViewState, type VisitorVisitViewState } from "@/lib/visitor/visit-details-state";

type AppointmentDetail = {
  id: string;
  facility_id: string;
  facility_name: string;
  facility_state: string;
  prisoner_id: string;
  prisoner_number: string;
  prisoner_name: string;
  prisoner_status: string;
  visitation_status: string;
  relationship_type: string | null;
  status: string;
  requested_start: string;
  requested_end: string;
  timezone: string;
  appointment_type: string;
  version: number;
  created_at: string;
  updated_at: string;
  waiting_room_state: string | null;
  visitor_presence: string | null;
  identity_state: string | null;
  camera_state: string | null;
  microphone_state: string | null;
  network_state: string | null;
  restriction_state: string | null;
  session_id: string | null;
  session_status: string | null;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  recording_policy: string | null;
  recording_status: string | null;
  device_check_id: string | null;
  device_camera_result: string | null;
  device_microphone_result: string | null;
  device_network_result: string | null;
  device_latency_ms: number | null;
  device_checked_at: string | null;
  visit_credit_status: "NOT_RESERVED" | "RESERVED" | "RETURNED" | "CONSUMED";
  settlement_ledger_entry_id: string | null;
  settlement_entry_type: "CONSUMPTION" | "RESERVATION_RELEASE" | null;
  settlement_amount: number | null;
  settlement_reason: string | null;
  settlement_created_at: string | null;
};

type StatusEvent = { from_status: string | null; to_status: string; reason_text: string | null; created_at: string };
type VisitApiResponse = { appointment?: AppointmentDetail; statusHistory?: StatusEvent[]; error?: string };
function formatDate(value: string, timezone: string, options: Intl.DateTimeFormatOptions = { dateStyle: "full" }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Schedule unavailable" : new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone || "Asia/Jakarta" }).format(date);
}

function formatTimeRange(appointment: AppointmentDetail) {
  const start = formatDate(appointment.requested_start, appointment.timezone, { hour: "2-digit", minute: "2-digit" });
  const end = formatDate(appointment.requested_end, appointment.timezone, { hour: "2-digit", minute: "2-digit" });
  return `${start}–${end} · ${appointment.timezone || "facility time"}`;
}

function prettyStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateContent(state: VisitorVisitViewState, appointment: AppointmentDetail, reviewReason?: string | null) {
  const name = appointment.prisoner_name;
  const facility = appointment.facility_name;
  const content: Record<VisitorVisitViewState, { eyebrow: string; title: string; copy: string; action: string | null; tone: "orange" | "blue" | "green" | "muted" }> = {
    review: { eyebrow: reviewReason ? "ACTION NEEDED" : "VISIT REQUEST", title: reviewReason ? "The facility needs a little more information" : "Your request is with the facility", copy: reviewReason || `We’ll update you when the facility team has reviewed your request to visit ${name}.`, action: null, tone: "blue" },
    approved: { eyebrow: "YOUR UPCOMING VISIT", title: "Your visit is approved", copy: `You’re approved to visit ${name} at ${facility}. Check your device before the visit.`, action: "Check this device", tone: "orange" },
    waiting: { eyebrow: "WAITING ROOM", title: "The facility is preparing your visit", copy: `Stay nearby. We’ll let you know when ${facility} is ready for you.`, action: null, tone: "green" },
    ready: { eyebrow: "YOUR VISIT IS READY", title: "The facility is ready for you", copy: `Your secure visit with ${name} can begin when you join.`, action: "Join your visit", tone: "orange" },
    live: { eyebrow: "VISIT IN PROGRESS", title: `You’re visiting ${name}`, copy: "Your secure video visit is in progress.", action: "Return to live visit", tone: "orange" },
    completed: { eyebrow: "VISIT COMPLETE", title: "Your visit is complete", copy: `This visit with ${name} has ended. The credit result below reflects the recorded ledger.`, action: null, tone: "green" },
    cancelled: { eyebrow: "VISIT CANCELLED", title: "This visit was cancelled", copy: "The visit status and credit result below are from your account record.", action: null, tone: "blue" },
    rejected: { eyebrow: "VISIT REQUEST", title: "This request was not approved", copy: "Please review your Connections or contact the facility before sending another request.", action: null, tone: "blue" },
    issue: { eyebrow: "VISIT NEEDS ATTENTION", title: "The facility recorded an issue", copy: "This visit could not proceed as planned. Contact the facility if you need help.", action: null, tone: "blue" },
  };
  return content[state];
}

export default function VisitorVisitDetailsClient({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [history, setHistory] = useState<StatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const waitingRoomKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      const nextController = new AbortController();
      controller = nextController;
      try {
        const response = await fetch(`/api/visitor/appointments/${encodeURIComponent(visitId)}`, { credentials: "include", headers: { accept: "application/json" }, cache: "no-store", signal: nextController.signal });
        const body = await response.json() as VisitApiResponse;
        if (!response.ok || !body.appointment) throw new Error(response.status === 404 ? "We couldn’t find that visit in your account." : body.error || "We couldn’t refresh this visit.");
        if (!active) return;
        setAppointment(body.appointment);
        setHistory(body.statusHistory || []);
        setLastUpdated(new Date().toISOString());
        setError("");
      } catch (cause) {
        if (!active || nextController.signal.aborted) return;
        setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : "We couldn’t refresh this visit.");
      } finally {
        if (active) setLoading(false);
      }
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      controller?.abort();
    };
  }, [visitId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const presenceAppointmentId = appointment?.id;
  const presenceAppointmentStatus = appointment?.status;
  const presenceState = appointment?.visitor_presence;
  useEffect(() => {
    if (!presenceAppointmentId || !["WAITING", "IN_PROGRESS"].includes(presenceAppointmentStatus || "") || presenceState !== "present") return;
    let active = true;
    const sendPresence = async () => {
      if (!active || document.visibilityState !== "visible") return;
      try {
        await fetch(`/api/visitor/appointments/${encodeURIComponent(presenceAppointmentId)}/waiting-room/presence`, {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
      } catch {
        // The next visit-detail refresh will surface a stale or unavailable waiting-room state.
      }
    };
    void sendPresence();
    const timer = window.setInterval(() => void sendPresence(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [presenceAppointmentId, presenceAppointmentStatus, presenceState]);

  const state = useMemo(() => appointment ? getVisitorVisitViewState(appointment) : null, [appointment]);
  const startsIn = appointment && now !== null ? Date.parse(appointment.requested_start) - now : 0;
  const countdown = startsIn > 0 && startsIn < 48 * 60 * 60 * 1000 && state === "approved";
  const latestInfoRequest = [...history].reverse().find((event) => event.to_status === "UNDER_REVIEW" && event.reason_text)?.reason_text || null;
  const presentation = appointment && state ? stateContent(state, appointment, latestInfoRequest) : null;
  const duration = appointment ? Math.max(0, Math.round((Date.parse(appointment.requested_end) - Date.parse(appointment.requested_start)) / 60000)) : 0;
  const initials = appointment?.prisoner_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";
  const decisionComplete = Boolean(appointment && !["SUBMITTED", "UNDER_REVIEW"].includes(appointment.status));
  const creditComplete = Boolean(appointment && appointment.visit_credit_status !== "NOT_RESERVED");
  const deviceCheckComplete = Boolean(appointment?.device_check_id);
  const videoStepComplete = Boolean(appointment?.actual_started_at && (state === "live" || state === "completed"));
  const completedSteps = 1 + Number(decisionComplete) + Number(creditComplete) + Number(deviceCheckComplete) + Number(videoStepComplete);

  function openDeviceCheck() {
    if (appointment && state === "approved") router.push(`/visitor/visits/${encodeURIComponent(appointment.id)}/device-check`);
  }

  function openLiveVisit() {
    if (appointment && ["ready", "live"].includes(state || "")) router.push(`/visitor/visits/${encodeURIComponent(appointment.id)}/live`);
  }

  async function enterWaitingRoom() {
    if (!appointment || checkInSaving) return;
    setCheckInSaving(true);
    setError("");
    try {
      const storageKey = `securevisit:waiting-room:${appointment.id}`;
      const idempotencyKey = waitingRoomKey.current || (typeof window !== "undefined" ? window.sessionStorage.getItem(storageKey) : null) || crypto.randomUUID();
      waitingRoomKey.current = idempotencyKey;
      if (typeof window !== "undefined") window.sessionStorage.setItem(storageKey, idempotencyKey);
      const response = await fetch(`/api/visitor/appointments/${encodeURIComponent(appointment.id)}/waiting-room`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json", "Idempotency-Key": idempotencyKey },
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "WAITING_ROOM_CHECK_IN_FAILED");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : "We couldn’t open the waiting room.");
    } finally {
      setCheckInSaving(false);
    }
  }

  if (loading) return <VisitPageMessage title="Loading your visit" body="Checking the latest status in your SecureVisit account." />;
  if ((!appointment && error) || !appointment || !presentation || !state) return <VisitPageMessage title="Visit details unavailable" body={error || "We couldn’t find that visit in your account."} action="Back to My Visits" />;

  const credit = appointment.visit_credit_status;
  const historyRows = history;
  const visitorAlreadyWaiting = appointment.visitor_presence === "present" || ["WAITING", "IN_PROGRESS"].includes(appointment.status);
  const canEnterWaitingRoom = deviceCheckComplete && appointment.status === "APPROVED" && !visitorAlreadyWaiting;
  const action = canEnterWaitingRoom ? enterWaitingRoom : presentation.action === "Check this device" ? openDeviceCheck : openLiveVisit;
  const actionLabel = canEnterWaitingRoom ? "Enter waiting room" : presentation.action;

  return <div className="sv3-visitor-app sv4-visitor-app sv5-details-app">
    <header className="sv4-header"><div className="sv4-header-inner"><Link className="sv4-brand" href="/visitor"><span className="sv4-brand-mark">+</span><span><strong>SecureVisit</strong><small>Visitor</small></span></Link><nav className="sv4-desktop-nav" aria-label="Visitor navigation"><Link href="/visitor">Home</Link><Link className="active" href="/visitor/visits">Visits</Link><Link href="/visitor/connections">Connections</Link><Link href="/visitor/credits">Credits</Link></nav><div className="sv4-header-actions"><span className="sv4-secure-note"><i />Secure session</span></div></div></header>
    <main className="sv4-main sv5-details-main"><div className="sv5-details-page">
      <Link className="sv5-back-link" href="/visitor/visits">← <span>My Visits</span></Link>
      {error && <p className="sv5-sync-warning" role="status">We couldn’t refresh this visit. Showing the last saved details{lastUpdated ? ` from ${formatDate(lastUpdated, appointment.timezone, { dateStyle: "medium", timeStyle: "short" })}` : ""}. {error}</p>}
      <section className={`sv5-visit-hero sv5-visit-hero-${presentation.tone}`}>
        <div className="sv5-hero-copy"><p className="sv4-kicker">{presentation.eyebrow}</p><div className="sv5-hero-person"><span className="sv4-avatar sv4-avatar-sage">{initials}</span><div><h1>{presentation.title}</h1><p>{presentation.copy}</p></div></div><div className="sv5-hero-meta"><span className={`sv4-status sv4-status-${presentation.tone === "orange" ? "orange" : presentation.tone === "blue" ? "blue" : "green"}`}><i />{prettyStatus(appointment.status)}</span><span>{appointment.prisoner_name} · {prettyStatus(appointment.appointment_type)} · {duration} minutes</span></div>{actionLabel && <button className="sv4-button sv4-button-primary sv5-primary-action" onClick={() => void action()} disabled={checkInSaving}>{checkInSaving ? "Opening waiting room…" : actionLabel} <span>→</span></button>}</div>
        <div className="sv5-hero-art" aria-hidden="true"><div className="sv5-art-sun" /><div className="sv5-art-arc" /><div className="sv5-art-portrait"><span>{initials}</span><i /></div><div className="sv5-art-card"><span>SECURE VISIT</span><strong>{formatDate(appointment.requested_start, appointment.timezone, { hour: "2-digit", minute: "2-digit" })}</strong><small>{appointment.timezone}</small></div></div>
        {countdown && <div className="sv5-countdown"><span>Scheduled start</span><strong>{formatDate(appointment.requested_start, appointment.timezone, { hour: "2-digit", minute: "2-digit" })}</strong><small>{formatDate(appointment.requested_start, appointment.timezone)}</small></div>}
      </section>

      <section className="sv5-prep-layout">
        <article className="sv5-panel sv5-preparation-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Your visit status</p><h2>{state === "review" ? "Waiting for the facility" : state === "completed" ? "Visit finished" : "Your next step"}</h2></div><strong>{completedSteps} of 5</strong></div><div className="sv5-progress-track" role="progressbar" aria-valuenow={completedSteps} aria-valuemin={0} aria-valuemax={5} aria-label={`Visit progress: ${completedSteps} of 5 steps`}><i style={{ width: `${completedSteps * 20}%` }} /></div><p className="sv5-progress-copy">Progress is based on saved appointment and session records.<span>{completedSteps * 20}%</span></p><div className="sv5-prep-list"><PreparationItem title="Request received" state={formatDate(appointment.created_at, appointment.timezone, { dateStyle: "medium", timeStyle: "short" })} done /><PreparationItem title="Facility decision" state={prettyStatus(appointment.status)} done={!["SUBMITTED", "UNDER_REVIEW"].includes(appointment.status)} current={state === "review"} /><PreparationItem title="Visit credit" state={prettyStatus(credit)} done={credit !== "NOT_RESERVED"} /><PreparationItem title="Device check" state={appointment.device_checked_at ? `Last checked ${formatDate(appointment.device_checked_at, appointment.timezone, { dateStyle: "medium", timeStyle: "short" })}` : "Not completed yet"} done={Boolean(appointment.device_check_id)} current={state === "approved" && !appointment.device_check_id} /><PreparationItem title="Secure video visit" state={appointment.session_status ? prettyStatus(appointment.session_status) : "Not started"} done={videoStepComplete} current={state === "ready"} /></div>{state === "approved" && <button className="sv4-button sv4-button-primary" onClick={openDeviceCheck}>Check this device <span>→</span></button>}{state === "ready" && <button className="sv4-button sv4-button-primary" onClick={openLiveVisit}>Join your visit <span>→</span></button>}</article>
        <article className={`sv5-panel sv5-waiting-panel sv5-waiting-${["waiting", "ready", "live"].includes(state) ? "open" : "closed"}`}><div className="sv5-waiting-illustration"><span>◷</span><i /></div><p className="sv4-kicker">Facility readiness</p><h2>{state === "ready" ? "Ready to join" : state === "live" ? "Visit in progress" : state === "waiting" ? "Waiting for staff" : "Waiting room"}</h2><p>{state === "waiting" ? "Your check-in is recorded. Stay on this page for the facility’s next update." : state === "ready" ? "The facility has marked your visit ready. Join using the secure visit button." : state === "live" ? "Your session has been started. Return to the live visit when needed." : "The waiting room and visit actions will appear here when the facility opens them."}</p><div className="sv5-waiting-time"><span>Scheduled time</span><strong>{formatTimeRange(appointment)}</strong></div>{state === "ready" && <button className="sv4-button sv4-button-primary" onClick={openLiveVisit}>Join your visit →</button>}</article>
      </section>

      <section className="sv5-info-layout"><article className="sv5-panel sv5-info-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Visit information</p><h2>The details you need</h2></div><span className="sv5-info-icon">⌁</span></div><div className="sv5-detail-grid"><Detail label="Date" value={formatDate(appointment.requested_start, appointment.timezone)} /><Detail label="Time" value={formatTimeRange(appointment)} /><Detail label="Visit type" value={prettyStatus(appointment.appointment_type)} /><Detail label="Duration" value={`${duration} minutes`} /><Detail label="Facility" value={appointment.facility_name} /><Detail label="Connection" value={`${appointment.prisoner_name} · ${appointment.relationship_type || "Approved connection"}`} /></div></article><article className="sv5-panel sv5-credit-panel"><div className="sv5-credit-symbol">◇</div><p className="sv4-kicker">Visit Credit</p><h2>{credit === "CONSUMED" ? "Credit used" : credit === "RETURNED" ? "Credit returned" : credit === "RESERVED" ? "Credit reserved" : "Not reserved yet"}</h2><p>{credit === "CONSUMED" ? "The ledger records this credit as used for the completed visit." : credit === "RETURNED" ? "The ledger records this credit as returned to your balance." : credit === "RESERVED" ? "One visit credit is reserved for this appointment." : "A credit has not been reserved for this appointment."}</p><Link className="sv5-inline-link" href="/visitor/credits">View my credits →</Link></article></section>
      {appointment.settlement_ledger_entry_id && <section className="sv5-panel sv5-receipt-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Completion receipt</p><h2>{appointment.settlement_entry_type === "CONSUMPTION" ? "Visit credit settled" : "Visit credit returned"}</h2></div><span className="sv5-info-icon">✓</span></div><p>This receipt is generated from the saved credit ledger settlement for this visit.</p><div className="sv5-detail-grid"><Detail label="Visit ID" value={appointment.id} /><Detail label="Ledger reference" value={appointment.settlement_ledger_entry_id} /><Detail label="Credit change" value={`${appointment.settlement_amount != null && appointment.settlement_amount > 0 ? "+" : ""}${appointment.settlement_amount ?? 0} credit`} /><Detail label="Outcome" value={appointment.settlement_entry_type === "CONSUMPTION" ? "Consumed" : "Returned"} /><Detail label="Recorded at" value={appointment.settlement_created_at ? formatDate(appointment.settlement_created_at, appointment.timezone, { dateStyle: "medium", timeStyle: "short" }) : "—"} /><Detail label="Reason" value={appointment.settlement_reason || "Recorded by SecureVisit settlement policy."} /></div><Link className="sv5-inline-link" href="/visitor/credits">View credit activity →</Link></section>}

      <section className="sv5-panel sv5-journey-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Saved history</p><h2>What has changed</h2></div><code>{appointment.id}</code></div><div className="sv5-journey-list">{historyRows.length ? historyRows.map((event, index) => <div className="sv5-journey-item sv5-journey-done" key={`${event.to_status}-${event.created_at}-${index}`}><span className="sv5-journey-marker">✓</span><span><strong>{prettyStatus(event.to_status)}</strong><small>{formatDate(event.created_at, appointment.timezone, { dateStyle: "medium", timeStyle: "short" })}</small></span></div>) : <p className="sv5-history-empty">No status changes have been recorded yet.</p>}</div></section>
      {appointment.device_checked_at && <section className="sv5-panel sv5-guidelines-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Device preparation</p><h2>Last check results</h2></div></div><p>Checked {formatDate(appointment.device_checked_at, appointment.timezone, { dateStyle: "medium", timeStyle: "short" })}. These visitor-reported results help you prepare; facility preflight is still required before a call can start.</p><div className="sv5-detail-grid"><Detail label="Camera" value={prettyStatus(appointment.device_camera_result || "unknown")} /><Detail label="Microphone" value={prettyStatus(appointment.device_microphone_result || "unknown")} /><Detail label="Connection" value={`${prettyStatus(appointment.device_network_result || "unknown")}${appointment.device_latency_ms === null ? "" : ` · ${appointment.device_latency_ms} ms`}`} /></div></section>}
      <section className="sv5-guidance-layout"><article className="sv5-panel sv5-guidelines-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Before your visit</p><h2>A few things to remember</h2></div></div><div className="sv5-guideline-list"><Guideline number="01" text="Join from a quiet, well-lit place." /><Guideline number="02" text="Use a working camera, microphone, and stable connection." /><Guideline number="03" text="Only approved participants may be present." /></div></article><article className="sv5-help-panel"><span className="sv5-help-spark">✦</span><p className="sv4-kicker">Need a hand?</p><h2>We’re here for your visit.</h2><p>Contact the facility if the details or status shown here do not look right.</p><Link className="sv4-button" href="/visitor/visits">Back to My Visits →</Link></article></section>
    </div></main>
  </div>;
}

function VisitPageMessage({ title, body, action }: { title: string; body: string; action?: string }) {
  return <main className="sv11-auth-shell"><section className="sv11-auth-card"><div className="sv11-auth-mark">+</div><span className="sv4-kicker">SECUREVISIT VISITOR</span><h1>{title}</h1><p role="status">{body}</p><Link className="sv4-button sv4-button-primary" href="/visitor">{action || "Go to visitor home"}</Link></section></main>;
}

function PreparationItem({ title, state, done, current = false }: { title: string; state: string; done: boolean; current?: boolean }) {
  return <div className={`sv5-prep-item ${done ? "done" : current ? "current" : "future"}`}><span>{done ? "✓" : current ? "!" : "○"}</span><strong>{title}</strong><small>{state}</small></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="sv5-detail-item"><small>{label}</small><strong>{value}</strong></div>;
}

function Guideline({ number, text }: { number: string; text: string }) {
  return <div className="sv5-guideline"><span>{number}</span><p>{text}</p><b>✓</b></div>;
}
