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

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "Never signed in";
}

export default function AccessReviewPanel() {
  const [data, setData] = useState<AccessReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
  </div>;
}
