"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "../../components/ControlPrimitives";

type NoticeTone = "success" | "warning" | "error" | "info";

type ReadinessResult = {
  status: "ready" | "not_ready";
  environment: string;
  checks?: {
    database?: boolean;
    schema?: boolean;
    providerConfiguration?: Record<string, boolean>;
    providerAdapters?: Record<string, string | null>;
    releaseGates?: { ready?: boolean; required?: string[]; missing?: string[] };
    environment?: { ok?: boolean; missing?: string[]; warnings?: string[] };
  };
};

export default function IntegrationReadinessPanel({ onNotify }: { onNotify: (message: string, tone?: NoticeTone) => void }) {
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    fetch("/api/health/readiness", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as ReadinessResult & { error?: string };
        if (!response.ok && !body.checks) throw new Error(body.error || "Readiness service unavailable.");
        setResult(body);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Readiness service unavailable."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const checks = result?.checks?.providerConfiguration || {};
  const adapters = result?.checks?.providerAdapters || {};
  const releaseGates = result?.checks?.releaseGates || { ready: false, required: [], missing: [] };
  const isDevelopment = result?.environment === "development";
  const runtimeReady = result?.status === "ready";
  const readinessLabel = loading ? "—" : isDevelopment ? "LOCAL ONLY" : runtimeReady ? "READY" : "ACTION NEEDED";
  const rows = [
    ["Database", result?.checks?.database],
    ["Schema", result?.checks?.schema],
    ["Payment", checks.payment],
    ["Payment webhooks", checks.paymentWebhook],
    ["Live video", checks.livekit],
    ["Evidence storage", checks.evidenceStorage],
    ["Evidence scanning", checks.evidenceScanning],
    ["Visitor authentication", checks.visitorAuth],
    ["Staff identity", checks.staffIdentity],
    ["Notifications", checks.notifications],
  ] as Array<[string, boolean | undefined]>;
  const gateRows = (releaseGates.required || []).map((key) => [key, !(releaseGates.missing || []).some((missing) => missing.startsWith(`${key}=`))] as [string, boolean]);
  const adapterRows = [["Payment", adapters.payment], ["Video", adapters.video], ["Visitor email", adapters.visitorEmail], ["Visitor SMS", adapters.visitorSms], ["Notifications email", adapters.notificationsEmail], ["Notifications SMS", adapters.notificationsSms], ["Evidence scanner", adapters.evidenceScanner], ["Staff federation", adapters.staffFederation]] as Array<[string, string | null | undefined]>;
  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Deployment readiness</span><strong>{readinessLabel}</strong><small>{result ? `${result.environment.toUpperCase()} environment · checked from the protected readiness API` : "Loading environment checks…"}</small></div>{error ? <div className="sv3-settings-surface"><Status tone="red">UNAVAILABLE</Status><strong>Readiness service unavailable</strong><p>{error}</p><Button onClick={() => load()}>Try again</Button></div> : loading ? <div className="sv3-empty"><strong>Loading integration health</strong><p>Reading the current deployment and facility bindings.</p></div> : <><div className="sv3-control-checks">{rows.map(([label, value]) => <div className="sv3-control-check" key={label}><span>{label}</span><Status tone={value ? "green" : "red"}>{value ? "READY" : "MISSING"}</Status></div>)}</div><div className="sv3-settings-surface"><span className="sv3-eyebrow">Active adapters</span><strong>Provider identities only</strong><p>These names are safe operational diagnostics. Credentials and endpoints are never returned.</p><div className="sv3-control-checks">{adapterRows.map(([label, value]) => <div className="sv3-control-check" key={label}><span>{label}</span><strong className="sv3-mono-value">{value || "not configured"}</strong></div>)}</div></div><div className="sv3-settings-surface"><span className="sv3-eyebrow">Institutional launch gates</span><strong>{gateRows.length ? (releaseGates.ready ? "All release attestations present." : "Launch remains blocked until the evidence gates are completed.") : "No production approval gates are required in this environment."}</strong>{gateRows.length ? <div className="sv3-control-checks">{gateRows.map(([label, value]) => <div className="sv3-control-check" key={label}><span>{label.replaceAll("SECUREVISIT_", "").replaceAll("_", " ")}</span><Status tone={value ? "green" : "red"}>{value ? "ATTESTED" : "MISSING"}</Status></div>)}</div> : null}<p>These checks expose only non-secret status. Production approval requires real provider, security, resilience, hardware, and institutional evidence; environment variables are not a substitute for that evidence.</p></div><div className="sv3-settings-surface"><Status tone={isDevelopment ? "orange" : runtimeReady ? "green" : "orange"}>{isDevelopment ? "LOCAL DEVELOPMENT ONLY" : runtimeReady ? "READY FOR CONFIGURED WORKFLOW" : "NOT READY"}</Status><strong>{isDevelopment ? "Local checks pass; pilot readiness is not being evaluated here." : runtimeReady ? "Required deployment checks are passing." : "This environment is not ready for institutional traffic."}</strong><p>Missing configuration names and non-secret warnings are shown below. Secret values are never returned to the workspace.</p>{result?.checks?.environment?.missing?.length ? <><span className="sv3-eyebrow">Missing configuration</span><ul>{result.checks.environment.missing.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{result?.checks?.environment?.warnings?.length ? <><span className="sv3-eyebrow">Warnings</span><ul>{result.checks.environment.warnings.map((item) => <li key={item}>{item}</li>)}</ul></> : null}<Button onClick={() => { load(); onNotify("Deployment readiness refreshed from the protected API.", "info"); }}>Refresh readiness</Button></div></>}</div>;
}

