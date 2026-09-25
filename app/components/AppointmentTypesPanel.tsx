"use client";

import { useEffect, useState } from "react";

type AppointmentType = { id: string; code: string; display_name: string; description: string; duration_minutes: number; credit_cost: number; status: string; version: number; updated_at: string };

export default function AppointmentTypesPanel() {
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/control/appointment-types", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { appointmentTypes?: AppointmentType[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Appointment types are unavailable.");
        setTypes(body.appointmentTypes || []);
        setError("");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Appointment types are unavailable."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Facility appointment types</strong><small>These active catalog entries are read by visitor appointment requests. Changes require a dedicated approval and version-history workflow.</small></div><button className="sv3-button" onClick={load} disabled={loading}>Refresh</button></div>
    {error ? <div className="sv3-empty" role="alert"><strong>Appointment types unavailable</strong><p>{error}</p><button className="sv3-button" onClick={load}>Try again</button></div> : loading ? <div className="sv3-empty"><strong>Loading appointment types</strong><p>Reading the facility-scoped catalog.</p></div> : !types.length ? <div className="sv3-empty"><strong>No appointment types configured</strong><p>Visitor requests cannot be created until the facility publishes an active type.</p></div> : <div className="sv3-policy-history">{types.map((type) => <article key={type.id}><div><span className="sv3-policy-version">{type.status}</span><strong>{type.display_name}</strong><span className="sv3-mono-value">{type.code}</span></div><p>{type.description} · {type.duration_minutes} minutes · {type.credit_cost} credit{type.credit_cost === 1 ? "" : "s"} · v{type.version}</p></article>)}</div>}
  </div>;
}
