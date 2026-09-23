"use client";

import { useEffect, useState } from "react";
import StaffObserverClient from "./StaffObserverClient";

type ObserverPayload = { token: string; serverUrl: string; session: { id: string; visitorName: string; prisonerName: string } };

export default function StaffObserverRouteClient({ sessionId }: { sessionId: string }) {
  const [reason, setReason] = useState("Routine live-session observation.");
  const [authorizedReason, setAuthorizedReason] = useState<string | null>(null);
  const [payload, setPayload] = useState<ObserverPayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authorizedReason) return;
    let active = true;
    async function authorize() {
      setStatus("loading");
      try {
        const response = await fetch(`/api/control/live-sessions/${encodeURIComponent(sessionId)}/observer-token`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "include", body: JSON.stringify({ reason: authorizedReason }), cache: "no-store" });
        const body = await response.json() as Partial<ObserverPayload> & { error?: string };
        if (!response.ok || typeof body.token !== "string" || typeof body.serverUrl !== "string" || !body.session) throw new Error(body.error || "The observer session could not be authorized.");
        if (active) setPayload(body as ObserverPayload);
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : "The observer session could not be authorized."); setStatus("error"); }
      }
    }
    void authorize();
    return () => { active = false; };
  }, [sessionId, authorizedReason]);

  if (payload) return <StaffObserverClient sessionId={payload.session.id} visitorName={payload.session.visitorName} prisonerName={payload.session.prisonerName} token={payload.token} serverUrl={payload.serverUrl} onClose={() => window.history.back()} />;
  return <main className="sv10-observer-loading"><section><span className="sv9-kicker">STAFF OBSERVER · READ ONLY</span><h1>{status === "loading" ? "Authorizing observer access…" : "Open a monitored session"}</h1>{status === "error" ? <p role="alert">{error}</p> : <p>The server will check your monitoring permission and record the access reason.</p>}<label>Observation reason<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} /></label>{status === "error" ? <button className="sv4-button" onClick={() => { setError(""); setAuthorizedReason(reason); }}>Try again</button> : <button className="sv4-button" disabled={reason.trim().length < 8} onClick={() => setAuthorizedReason(reason.trim())}>Start read-only observation</button>}</section></main>;
}
