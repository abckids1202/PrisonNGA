"use client";

import { useEffect, useState } from "react";

type AccessReviewMember = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  last_login_at: string | null;
  version: number;
  employee_reference: string;
  job_title: string;
  department: string | null;
  roles: string | null;
  active_session_count: number;
};

type AccessReviewResponse = {
  generatedAt?: string;
  summary?: { total: number; active: number; suspended: number; disabled: number; activeSessions: number };
  staff?: AccessReviewMember[];
  error?: string;
};

type StaffSession = {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  recognized_browser: number;
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "Never signed in";
}

export default function AccessReviewPanel() {
  const [data, setData] = useState<AccessReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<StaffSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionReason, setSessionReason] = useState("Supervisor revoked an untrusted or no-longer-needed staff session.");
  const [revokingSessionId, setRevokingSessionId] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/control/access-review", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as AccessReviewResponse;
        if (!response.ok) throw new Error(body.error || "Unable to load access review.");
        setData(body);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load access review."))
      .finally(() => setLoading(false));
  };

  const loadSessions = () => {
    setSessionsLoading(true);
    fetch("/api/control/access-review/sessions", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { sessions?: StaffSession[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to load active staff sessions.");
        setSessions(body.sessions || []);
        setSessionsError("");
      })
      .catch((reason: unknown) => setSessionsError(reason instanceof Error ? reason.message : "Unable to load active staff sessions."))
      .finally(() => setSessionsLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    const sessionTimer = window.setTimeout(loadSessions, 0);
    return () => { window.clearTimeout(timer); window.clearTimeout(sessionTimer); };
  }, []);

  const revokeSession = async (session: StaffSession) => {
    if (sessionReason.trim().length < 8) {
      setSessionsError("Add a specific reason of at least 8 characters before revoking a session.");
      return;
    }
    setRevokingSessionId(session.id);
    setSessionsError("");
    try {
      const response = await fetch("/api/control/access-review/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `staff-session-revoke-${session.id}-${crypto.randomUUID()}` },
        body: JSON.stringify({ userId: session.user_id, sessionId: session.id, reason: sessionReason }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to revoke the staff session.");
      loadSessions();
    } catch (reason: unknown) {
      setSessionsError(reason instanceof Error ? reason.message : "Unable to revoke the staff session.");
    } finally {
      setRevokingSessionId("");
    }
  };

  const summary = data?.summary;
  return <div className="sv3-admin-content">
    <div className="sv3-admin-stat"><span>Access posture</span><strong>{loading ? "—" : summary?.activeSessions ?? 0}</strong><small>Active staff sessions · generated {data?.generatedAt ? formatDate(data.generatedAt) : "—"}</small></div>
    <div className="sv3-command-metrics">
      <div className="sv3-metric"><span>Total staff</span><strong>{loading ? "—" : summary?.total ?? 0}</strong><small>Facility-scoped accounts</small></div>
      <div className="sv3-metric"><span>Active</span><strong>{loading ? "—" : summary?.active ?? 0}</strong><small>Permitted to sign in</small></div>
      <div className="sv3-metric"><span>Suspended</span><strong>{loading ? "—" : summary?.suspended ?? 0}</strong><small>Access temporarily blocked</small></div>
      <div className="sv3-metric"><span>Disabled</span><strong>{loading ? "—" : summary?.disabled ?? 0}</strong><small>Access permanently disabled</small></div>
    </div>
    {error ? <div className="sv3-settings-surface"><strong>Access review unavailable</strong><p>{error}</p><button className="sv3-button" onClick={load}>Try again</button></div> : loading ? <div className="sv3-empty"><strong>Loading access review</strong><p>Reading facility-scoped staff and active-session records.</p></div> : !data?.staff?.length ? <div className="sv3-empty"><strong>No staff accounts</strong><p>No staff records exist in this facility scope.</p></div> : <div className="sv3-staff-list">{data.staff.map((member) => <div className="sv3-notification-failure" key={member.id}><span><strong>{member.display_name}</strong><small>{member.job_title} · {member.department || "No department"}</small><small>{member.email} · {member.employee_reference}</small></span><span><small>{member.roles || "No assigned role"}</small><small>Last login · {formatDate(member.last_login_at)}</small></span><span><small>{member.active_session_count} active session{member.active_session_count === 1 ? "" : "s"}</small><small>Record v{member.version}</small></span><span className={`sv3-status ${member.status === "ACTIVE" ? "sv3-status-green" : "sv3-status-red"}`}>{member.status}</span></div>)}</div>}
    <section className="sv3-settings-surface" aria-labelledby="staff-sessions-title">
      <div className="sv3-rule-line"><div><strong id="staff-sessions-title">Active staff sessions</strong><small>Review facility-scoped browser sessions without exposing IP addresses or session secrets.</small></div><button className="sv3-button" onClick={loadSessions} disabled={sessionsLoading}>Refresh</button></div>
      <label className="sv3-policy-reason">Revocation reason<textarea value={sessionReason} maxLength={500} onChange={(event) => setSessionReason(event.target.value)} /></label>
      {sessionsError ? <p className="sv3-policy-feedback error" role="alert">{sessionsError}</p> : null}
      {sessionsLoading ? <div className="sv3-empty"><strong>Loading active sessions</strong><p>Reading current staff session records.</p></div> : sessions.length ? <div className="sv3-staff-list">{sessions.map((session) => <div className="sv3-notification-failure" key={session.id}><span><strong>{session.display_name}</strong><small>{session.email || "Email unavailable"}</small></span><span><small>{session.recognized_browser ? "Recognized browser" : "Browser session"}</small><small>Last active · {formatDate(session.last_seen_at)}</small></span><span><small>Created · {formatDate(session.created_at)}</small><small>Expires · {formatDate(session.expires_at)}</small></span><button className="sv3-button" onClick={() => void revokeSession(session)} disabled={revokingSessionId === session.id}>{revokingSessionId === session.id ? "Revoking…" : "Revoke"}</button></div>)}</div> : <div className="sv3-empty"><strong>No active staff sessions</strong><p>There are no unexpired sessions in this facility scope.</p></div>}
    </section>
  </div>;
}
