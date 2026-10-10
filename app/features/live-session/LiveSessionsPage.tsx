"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, PageHeader, Status } from "../../components/ControlPrimitives";
import StaffObserverClient from "./StaffObserverClient";

type NoticeTone = "success" | "warning" | "error" | "info";

type LiveSessionRow = {
  id: string;
  appointment_id: string;
  status: string;
  provider: string;
  authorized_start_at: string;
  authorized_end_at: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  recording_policy: string;
  recording_status: string;
  finalization_blocked?: number | boolean;
  termination_reason: string | null;
  visitor_name: string;
  prisoner_name: string;
  prisoner_number: string;
  requested_start: string;
  requested_end: string;
  appointment_type: string;
  room_name: string | null;
  kiosk_name: string | null;
  participants: Array<{ identity: string; participant_role: string; status: string; last_seen_at: string; disconnected_at: string | null }>;
};

type LiveSessionDetail = {
  events: Array<{ id: string; event_type: string; source: string; participant_role: string | null; metadata: string | null; correlation_id: string | null; created_at: string }>;
  reconciliation: { required: boolean; id?: string; action_type?: string; reason?: string | null; correlation_id?: string | null; request_id?: string | null; created_at?: string; new_values?: string | null };
};

export default function LiveSessionsPage({ onNotify }: { onNotify: (message: string, tone?: NoticeTone) => void }) {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([]);
  const [recentlyEnded, setRecentlyEnded] = useState<LiveSessionRow[]>([]);
  const [selected, setSelected] = useState<LiveSessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [observer, setObserver] = useState<(LiveSessionRow & { token: string; serverUrl: string }) | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LiveSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequestRef = useRef(0);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/control/live-sessions", { headers: { accept: "application/json" }, cache: "no-store" });
      const body = await response.json() as { sessions?: LiveSessionRow[]; recentlyEnded?: LiveSessionRow[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Live Session data could not be loaded.");
      const active = body.sessions || [];
      const ended = body.recentlyEnded || [];
      setSessions(active);
      setRecentlyEnded(ended);
      setSelected((current) => current ? active.concat(ended).find((row) => row.id === current.id) || null : null);
      setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setSyncError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live Session data could not be loaded.";
      setSyncError(message);
      if (!quiet) onNotify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  async function endSession(session: LiveSessionRow) {
    setEnding(true);
    try {
      const response = await fetch(`/api/control/live-sessions/${session.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `live-session-end-${crypto.randomUUID()}` },
        body: JSON.stringify({ reason: "Staff ended the authorized visit from Live Sessions." }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The session could not be ended.");
      setSelected(null);
      await refresh(true);
      onNotify("The session end was recorded. Credit settlement and resource release were processed by the server.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "The session could not be ended.", "error");
    } finally {
      setEnding(false);
    }
  }

  async function authorizeObserver(session: LiveSessionRow) {
    try {
      const response = await fetch(`/api/control/live-sessions/${session.id}/observer-token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reason: "Routine supervision of an authorized live visit." }),
      });
      const body = await response.json() as { error?: string; token?: string; serverUrl?: string };
      if (!response.ok) throw new Error(body.error || "Observer authorization was denied.");
      if (!body.token || !body.serverUrl) throw new Error("Observer authorization returned no connection details.");
      setObserver({ ...session, token: body.token, serverUrl: body.serverUrl });
      onNotify("Read-only observer access authorized and connected.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Observer authorization was denied.", "error");
    }
  }

  async function loadSessionDetail(sessionId: string) {
    const requestNumber = ++detailRequestRef.current;
    setSelectedDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await fetch(`/api/control/live-sessions/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" });
      const body = await response.json() as { events?: LiveSessionDetail["events"]; reconciliation?: LiveSessionDetail["reconciliation"]; error?: string };
      if (!response.ok) throw new Error(body.error || "Session detail could not be loaded.");
      if (requestNumber === detailRequestRef.current) setSelectedDetail({ events: body.events || [], reconciliation: body.reconciliation || { required: false } });
    } catch (error) {
      if (requestNumber === detailRequestRef.current) {
        setSelectedDetail(null);
        setDetailError(error instanceof Error ? error.message : "Session detail could not be loaded.");
      }
    } finally {
      if (requestNumber === detailRequestRef.current) setDetailLoading(false);
    }
  }

  function displayTime(value: string | null) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function participantLabel(role: string) {
    if (role === "VISITOR") return "Visitor";
    if (role === "FACILITY") return "Facility kiosk";
    if (role === "STAFF_OBSERVER") return "Staff observer";
    return role.replaceAll("_", " ");
  }

  function sessionCard(session: LiveSessionRow) {
    const active = sessions.some((item) => item.id === session.id);
    const tone = session.finalization_blocked ? "red" : session.status === "ACTIVE" ? "green" : session.status === "RECONNECTING" ? "orange" : active ? "blue" : "gray";
    return <button className={`sv10-session-card ${selected?.id === session.id ? "selected" : ""}`} key={session.id} onClick={() => { setSelected(session); void loadSessionDetail(session.id); }}>
      <div className="sv10-card-top"><Status tone={tone}>{session.finalization_blocked ? "SETTLEMENT REVIEW" : session.status.replaceAll("_", " ")}</Status><span>{session.appointment_type} · <span className="sv-mono">{session.id}</span></span></div>
      <div className="sv10-card-people"><Avatar initials={session.visitor_name.split(/\\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()} tone="orange" /><span>↔</span><Avatar initials={session.prisoner_name.split(/\\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()} tone="blue" /></div>
      <h2>{session.visitor_name} <span>↔</span> {session.prisoner_name}</h2>
      <p>{session.room_name || "Room not assigned"} · {session.kiosk_name || "Device not assigned"}</p>
      <div className="sv10-card-time"><strong>{displayTime(session.actual_started_at || session.authorized_start_at)}</strong><small>{active ? "started" : "session start"}</small></div>
      <div className="sv10-card-health"><span>Recording <b>{session.recording_policy === "OFF" ? "Off" : session.recording_status}</b></span><span>Provider <b>{session.provider}</b></span><span>Participants <b>{session.participants?.filter((participant) => participant.status === "CONNECTED").length || 0} connected</b></span></div>
      <span className="sv10-open">Open persisted session record <b>→</b></span>
    </button>;
  }

  const attentionCount = sessions.filter((session) => Boolean(session.finalization_blocked) || ["RECONNECTING", "ENDING", "CONNECTING"].includes(session.status)).length;
  return <div className="sv10-live-page"><PageHeader eyebrow="Operations · Authorized monitoring" title="Live Sessions" description="Facility-scoped sessions and completion records, refreshed from the session service." actions={<><span className="sv10-active-count"><i />{sessions.length} ACTIVE SESSION{sessions.length === 1 ? "" : "S"}</span><Button variant="primary" onClick={() => void refresh()}>↻ Refresh sessions</Button></>} />
    {syncError ? <div className="sv10-empty" role="alert"><strong>Session service unavailable</strong><span>{syncError} Displayed records may be stale; no demo sessions are substituted.</span></div> : null}
    <div className="sv10-live-summary"><div><span>Active now</span><strong>{sessions.length}</strong><small>persisted sessions</small></div><div><span>Needs attention</span><strong>{attentionCount}</strong><small>including settlement recovery</small></div><div><span>Recording</span><strong>{sessions.every((session) => session.recording_policy === "OFF") ? "OFF" : "POLICY"}</strong><small>server policy</small></div><div><span>Recently ended</span><strong>{recentlyEnded.length}</strong><small>last 24 hours</small></div></div>
    <div className="sv10-workspace"><section className="sv10-session-column"><div className="sv10-section-heading"><div><span className="sv9-kicker">ACTIVE SESSIONS</span><h2>In progress</h2></div><span>{lastSync ? `Updated ${lastSync}` : "Not synced"}</span></div><div className="sv10-session-grid">{loading ? <div className="sv10-empty"><strong>Loading session records…</strong></div> : sessions.length ? sessions.map(sessionCard) : <div className="sv10-empty"><strong>No active visits</strong><span>Persisted sessions started from Waiting Room will appear here.</span></div>}</div><div className="sv10-section-heading sv10-recent-heading"><div><span className="sv9-kicker">COMPLETION</span><h2>Recently ended</h2></div><span>{recentlyEnded.length} recorded</span></div><div className="sv10-session-grid sv10-recent-grid">{recentlyEnded.length ? recentlyEnded.slice(0, 6).map(sessionCard) : <div className="sv10-empty"><strong>No recent session records</strong><span>Completed and terminated sessions are retained here for 24 hours.</span></div>}</div></section><aside className="sv10-ops-rail"><span className="sv9-kicker">SESSION OPERATIONS</span><h2>Keep the call safe</h2><p>Only persisted session facts are shown. Participant connectivity and media quality appear when provider telemetry is available.</p><div className="sv10-rail-list"><div><span className="sv10-rail-icon">◉</span><span><strong>Media plane</strong><small>LiveKit session provider</small></span></div><div><span className="sv10-rail-icon">◷</span><span><strong>Timer authority</strong><small>Server-authorized visit window</small></span></div><div><span className="sv10-rail-icon">▣</span><span><strong>Recording policy</strong><small>Shown per session record</small></span></div></div></aside></div>
    {selected ? <div className="sv10-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setSelectedDetail(null); } }}><aside className="sv10-drawer" role="dialog" aria-modal="true" aria-labelledby="live-session-title"><header><div><span className="sv9-kicker">PERSISTED SESSION · <span className="sv-mono">{selected.id}</span></span><h2 id="live-session-title">{selected.visitor_name}</h2><p>{selected.prisoner_name} · #{selected.prisoner_number}</p></div><button aria-label="Close session details" onClick={() => { setSelected(null); setSelectedDetail(null); }}>×</button></header><div className="sv10-drawer-body"><div className="sv10-drawer-state"><Status tone={selected.finalization_blocked ? "red" : selected.status === "ACTIVE" ? "green" : selected.status === "RECONNECTING" ? "orange" : "blue"}>{selected.finalization_blocked ? "SETTLEMENT REVIEW" : selected.status.replaceAll("_", " ")}</Status><span>Session times are server-recorded</span></div><section><span className="sv9-kicker">SCHEDULE & RESOURCE</span><div className="sv10-policy-row"><span>Scheduled</span><strong>{displayTime(selected.requested_start)} – {displayTime(selected.requested_end)}</strong></div><div className="sv10-policy-row"><span>Started</span><strong>{displayTime(selected.actual_started_at)}</strong></div><div className="sv10-policy-row"><span>Ended</span><strong>{displayTime(selected.actual_ended_at)}</strong></div><div className="sv10-policy-row"><span>Room / device</span><strong>{selected.room_name || "Not assigned"} · {selected.kiosk_name || "Not assigned"}</strong></div></section><section><span className="sv9-kicker">VIDEO POLICY</span><div className="sv10-policy-row"><span>Provider</span><strong>{selected.provider}</strong></div><div className="sv10-policy-row"><span>Recording</span><strong>{selected.recording_policy} · {selected.recording_status}</strong></div><div className="sv10-policy-row"><span>Termination note</span><strong>{selected.termination_reason || "None recorded"}</strong></div></section>{detailLoading ? <section><span className="sv9-kicker">SESSION EVIDENCE</span><p className="sv10-event-note">Loading persisted events and settlement status…</p></section> : detailError ? <section role="alert"><span className="sv9-kicker">SESSION EVIDENCE</span><p className="sv10-event-note">{detailError}</p><Button onClick={() => void loadSessionDetail(selected.id)}>Retry</Button></section> : selectedDetail?.reconciliation.required ? <section><span className="sv9-kicker">SETTLEMENT RECOVERY</span><Status tone="red">MANUAL REVIEW REQUIRED</Status><p className="sv10-event-note">{selectedDetail.reconciliation.reason || "The session closed without a confirmed credit settlement."}</p><small className="sv-mono">Audit {selectedDetail.reconciliation.id || "not available"} · {displayTime(selectedDetail.reconciliation.created_at || null)}</small></section> : <section><span className="sv9-kicker">SESSION EVIDENCE</span><p className="sv10-event-note">{selectedDetail ? `${selectedDetail.events.length} persisted session event${selectedDetail.events.length === 1 ? "" : "s"}.` : "Select a session to load its persisted evidence."}</p>{selectedDetail?.events.slice(0, 4).map((event) => <div className="sv10-policy-row" key={event.id}><span>{event.event_type.replaceAll("_", " ")}</span><strong>{displayTime(event.created_at)}</strong></div>)}</section>}<section><span className="sv9-kicker">PARTICIPANT TELEMETRY</span>{selected.participants.length ? selected.participants.map((participant) => <div className="sv10-policy-row" key={participant.identity}><span>{participantLabel(participant.participant_role)}<small>{participant.identity}</small></span><strong>{participant.status.replaceAll("_", " ")}<small>Last seen {displayTime(participant.last_seen_at)}</small></strong></div>) : <p className="sv10-event-note">No participant provider events have been recorded yet.</p>}<p className="sv10-event-note">Connectivity status is based on signed provider events. Media-quality metrics are not supplied by the current provider webhook.</p></section></div><footer><Button onClick={() => void authorizeObserver(selected)} disabled={!sessions.some((session) => session.id === selected.id)}>Open read-only observer</Button>{sessions.some((session) => session.id === selected.id) ? <Button variant="danger" disabled={ending} onClick={() => void endSession(selected)}>{ending ? "Ending…" : "End Visit"}</Button> : null}</footer></aside></div> : null}{observer ? <StaffObserverClient sessionId={observer.id} visitorName={observer.visitor_name} prisonerName={observer.prisoner_name} token={observer.token} serverUrl={observer.serverUrl} onClose={() => setObserver(null)} /> : null}</div>;
}


