"use client";

import { useEffect, useRef, useState } from "react";
import LiveSessionClient from "@/app/features/live-session/LiveSessionClient";

type Result = "ready" | "warning" | "failed";
type NetworkResult = "stable" | "fair" | "poor" | "unknown";

function checkLabel(result: Result | NetworkResult | null) {
  if (result === "ready" || result === "stable") return "Ready";
  if (result === "warning" || result === "fair") return "Review";
  if (result === "failed" || result === "poor") return "Failed";
  return "Not checked";
}

function KioskCheck({ label, result, detail }: { label: string; result: Result | NetworkResult | null; detail: string }) {
  return <article className={`sv-kiosk-check sv-kiosk-check-${result || "pending"}`}><span className="sv-kiosk-check-mark">{result === "ready" || result === "stable" ? "✓" : result === "warning" || result === "fair" ? "!" : result === "failed" || result === "poor" ? "×" : "○"}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{checkLabel(result)}</b></article>;
}

export default function KioskPreparationClient({ visitId }: { visitId: string }) {
  const [deviceId, setDeviceId] = useState("");
  const [credential, setCredential] = useState("");
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const [credentialInput, setCredentialInput] = useState("");
  const [phase, setPhase] = useState<"auth" | "checking" | "ready" | "error">("auth");
  const [error, setError] = useState("");
  const [camera, setCamera] = useState<Result | null>(null);
  const [microphone, setMicrophone] = useState<Result | null>(null);
  const [network, setNetwork] = useState<NetworkResult | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [liveStarted, setLiveStarted] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  useEffect(() => {
    if (!deviceId || !credential) return;
    let active = true;
    const headers = { accept: "application/json", "x-securevisit-kiosk-id": deviceId, "x-securevisit-kiosk-token": credential };
    const heartbeat = () => fetch("/api/kiosk/heartbeat", { method: "POST", headers, cache: "no-store" }).catch(() => undefined);
    const presence = () => fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/presence`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ presence: "present" }), cache: "no-store" }).catch(() => undefined);
    const clearPresence = () => {
      void fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/presence`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ presence: "absent" }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    };
    const onPageHide = () => clearPresence();
    window.addEventListener("pagehide", onPageHide);
    void heartbeat();
    void presence();
    const timer = window.setInterval(() => { if (active) { void heartbeat(); void presence(); } }, 15_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("pagehide", onPageHide); clearPresence(); };
  }, [deviceId, credential, visitId]);

  useEffect(() => {
    if (!deviceId || !credential || phase !== "ready" || liveStarted) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/live-session`, { headers: { accept: "application/json", "x-securevisit-kiosk-id": deviceId, "x-securevisit-kiosk-token": credential }, cache: "no-store" });
        if (active && response.ok) setLiveStarted(true);
      } catch { /* A temporary status failure leaves the kiosk on the preparation screen. */ }
    };
    void poll();
    const timer = window.setInterval(() => { if (active) void poll(); }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [deviceId, credential, phase, liveStarted, visitId]);

  async function runChecks(nextDeviceId = deviceId, nextCredential = credential) {
    setPhase("checking");
    setError("");
    setCamera(null);
    setMicrophone(null);
    setNetwork(null);
    const authHeaders = { accept: "application/json", "x-securevisit-kiosk-id": nextDeviceId, "x-securevisit-kiosk-token": nextCredential };
    try {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
      catch { setCamera("failed"); setMicrophone("failed"); throw new Error("The kiosk camera or microphone could not be opened."); }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      const videoReady = stream.getVideoTracks().some((track) => track.readyState === "live");
      const audioReady = stream.getAudioTracks().some((track) => track.readyState === "live");
      setCamera(videoReady ? "ready" : "failed");
      setMicrophone(audioReady ? "ready" : "failed");
      const started = performance.now();
      const response = await fetch(`/favicon.svg?kiosk-check=${Date.now()}`, { cache: "no-store" });
      const elapsed = Math.max(0, Math.round(performance.now() - started));
      setLatency(elapsed);
      const networkResult: NetworkResult = !response.ok ? "poor" : elapsed <= 250 ? "stable" : elapsed <= 650 ? "fair" : "poor";
      setNetwork(networkResult);
      const idempotencyKey = keyRef.current || (typeof window !== "undefined" ? window.sessionStorage.getItem(`securevisit:kiosk-device-check:${visitId}:${nextDeviceId}`) : null) || crypto.randomUUID();
      keyRef.current = idempotencyKey;
      if (typeof window !== "undefined") window.sessionStorage.setItem(`securevisit:kiosk-device-check:${visitId}:${nextDeviceId}`, idempotencyKey);
      const checkResponse = await fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/device-check`, { method: "POST", headers: { ...authHeaders, "content-type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ cameraResult: videoReady ? "ready" : "failed", microphoneResult: audioReady ? "ready" : "failed", networkResult, latencyMs: elapsed }), cache: "no-store" });
      const body = await checkResponse.json() as { error?: string };
      if (!checkResponse.ok) throw new Error(body.error || "The kiosk readiness result could not be saved.");
      setPhase("ready");
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "The device check could not be completed.");
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  if (phase === "auth") return <main className="sv-kiosk-shell"><header className="sv-kiosk-header"><span className="sv9-brand-mark">+</span><div><strong>SecureVisit</strong><small>Controlled facility device</small></div></header><section className="sv-kiosk-card"><span className="sv9-kicker">KIOSK PREPARATION</span><h1>Connect this assigned kiosk</h1><p>Use the facility-issued device ID and one-time credential. Credentials stay in this page’s memory.</p><form className="sv9-kiosk-auth-form" onSubmit={(event) => { event.preventDefault(); const nextDeviceId = deviceIdInput.trim(); const nextCredential = credentialInput.trim(); if (!nextDeviceId || !nextCredential) return; setDeviceId(nextDeviceId); setCredential(nextCredential); setCredentialInput(""); void runChecks(nextDeviceId, nextCredential); }}><label>Registered device ID<input autoComplete="off" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} required /></label><label>Facility credential<input type="password" autoComplete="off" value={credentialInput} onChange={(event) => setCredentialInput(event.target.value)} required /></label><button className="sv9-button sv9-button-primary" type="submit">Start device check →</button></form></section></main>;

  if (liveStarted) return <LiveSessionClient visitId={visitId} role="FACILITY" kioskId={deviceId} initialKioskCredential={credential} />;

  const overallReady = camera === "ready" && microphone === "ready" && ["stable", "fair"].includes(network || "") && phase === "ready";
  return <main className="sv-kiosk-shell"><header className="sv-kiosk-header"><span className="sv9-brand-mark">+</span><div><strong>SecureVisit</strong><small>Controlled facility device · {deviceId}</small></div><span className="sv-kiosk-live-dot"><i /> Device connected</span></header><section className="sv-kiosk-card sv-kiosk-card-wide"><div className="sv-kiosk-card-heading"><div><span className="sv9-kicker">VISIT {visitId}</span><h1>{overallReady ? "This kiosk is ready" : phase === "checking" ? "Checking this kiosk" : "Kiosk needs attention"}</h1><p>{overallReady ? "The results are saved. Staff can now complete the pre-call checks and admit the visit." : phase === "checking" ? "Testing camera, microphone, and connection. Keep this page open." : error || "Resolve the failed checks and run the test again."}</p></div><span className={`sv-kiosk-overall ${overallReady ? "ready" : "pending"}`}>{overallReady ? "READY" : phase === "checking" ? "CHECKING" : "ACTION NEEDED"}</span></div><div className="sv-kiosk-check-grid"><KioskCheck label="Camera" result={camera} detail="Video input available" /><KioskCheck label="Microphone" result={microphone} detail="Audio input available" /><KioskCheck label="Network" result={network} detail={latency === null ? "Connection quality" : `${latency} ms response`} /></div><div className="sv-kiosk-actions">{phase !== "checking" && <button className="sv9-button sv9-button-primary" onClick={() => void runChecks()}>{overallReady ? "Run check again" : "Retry device check"} →</button>}<span>Presence is reported to the facility while this page is open.</span></div></section></main>;
}
