"use client";

import { useState } from "react";

type CredentialCommand = "issue_kiosk_credential" | "revoke_kiosk_credential";

type Props = {
  resourceId: string;
  resourceName: string;
  resourceVersion: number;
  active: boolean;
  lastUsedAt?: string | null;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, tone?: "success" | "error" | "warning" | "info") => void;
};

export default function KioskCredentialManager({ resourceId, resourceName, resourceVersion, active, lastUsedAt, onRefresh, onNotify }: Props) {
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState<CredentialCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function execute(command: CredentialCommand) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/control/resources", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({ resourceId, command, expectedVersion: resourceVersion, reason: reason.trim() }),
      });
      const body = await response.json() as {
        error?: string;
        credential?: { token: string };
        credentialStatus?: string;
      };
      if (!response.ok) {
        if (body.error === "STEP_UP_REQUIRED") throw new Error("A fresh supervisor verification from the institution’s identity provider is required. No credential was changed.");
        if (body.error === "STEP_UP_INVALID") throw new Error("The supervisor verification was invalid or expired. No credential was changed.");
        if (body.error === "STALE_RESOURCE") throw new Error("This device changed while you were reviewing it. Refresh the resource and try again.");
        if (body.error === "AUTHORIZATION_REQUIRED") throw new Error("Your staff account is not authorized to manage kiosk credentials.");
        throw new Error(body.error || "The credential change was rejected.");
      }

      setReviewing(null);
      setReason("");
      if (command === "issue_kiosk_credential" && body.credential?.token) {
        setOneTimeToken(body.credential.token);
        onNotify(`${resourceName} credential issued. Copy it now; it will not be shown again.`, "success");
      } else {
        setOneTimeToken(null);
        onNotify(`${resourceName} credential revoked.`, "success");
      }
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The credential change failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!oneTimeToken) return;
    try {
      await navigator.clipboard.writeText(oneTimeToken);
      onNotify("One-time kiosk credential copied. Store it in the device’s protected secret store.", "success");
    } catch {
      setMessage("Clipboard access was unavailable. Select and copy the displayed credential manually.");
    }
  }

  return (
    <section className="sv3-kiosk-credential" aria-labelledby={`kiosk-credential-${resourceId}`}>
      <div className="sv3-kiosk-credential-heading">
        <div>
          <span className="sv3-eyebrow">Device access</span>
          <h3 id={`kiosk-credential-${resourceId}`}>Kiosk credential</h3>
        </div>
        <span className={`sv3-kiosk-credential-state ${active ? "active" : "inactive"}`}>
          <i />{active ? "ACTIVE" : "NOT ISSUED"}
        </span>
      </div>
      <p className="sv3-kiosk-credential-copy">
        {active ? "The kiosk uses this secret to prove its device identity before receiving a LiveKit token." : "Issue a device-specific secret before connecting this kiosk to a live visit."}
      </p>
      {lastUsedAt ? <p className="sv3-kiosk-last-used">Last authenticated <time dateTime={lastUsedAt}>{new Date(lastUsedAt).toLocaleString()}</time></p> : null}

      {oneTimeToken ? (
        <div className="sv3-kiosk-secret" aria-live="polite">
          <strong>Shown once — copy it now</strong>
          <label className="sv3-sr-only" htmlFor={`kiosk-token-${resourceId}`}>One-time kiosk credential</label>
          <input id={`kiosk-token-${resourceId}`} value={oneTimeToken} readOnly spellCheck={false} autoComplete="off" />
          <div>
            <button type="button" className="sv3-button" onClick={() => void copyToken()}>Copy credential</button>
            <button type="button" className="sv3-button sv3-button-quiet" onClick={() => setOneTimeToken(null)}>Hide secret</button>
          </div>
          <small>Provision this value into the kiosk’s protected local secret store. It is not saved in SecureVisit or browser storage.</small>
        </div>
      ) : null}

      <label className="sv3-kiosk-reason-label" htmlFor={`kiosk-reason-${resourceId}`}>Audit reason</label>
      <textarea
        id={`kiosk-reason-${resourceId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value.slice(0, 500))}
        maxLength={500}
        minLength={8}
        placeholder="Explain why this device credential needs to change"
        disabled={busy}
      />
      <div className="sv3-kiosk-credential-actions">
        <button type="button" className="sv3-button sv3-button-primary" disabled={busy || reason.trim().length < 8} onClick={() => { setMessage(null); setReviewing("issue_kiosk_credential"); }}>
          {active ? "Rotate credential" : "Issue credential"}
        </button>
        {active ? <button type="button" className="sv3-button sv3-button-danger" disabled={busy || reason.trim().length < 8} onClick={() => { setMessage(null); setReviewing("revoke_kiosk_credential"); }}>Revoke</button> : null}
      </div>

      {reviewing ? (
        <div className="sv3-kiosk-review" role="group" aria-labelledby={`kiosk-review-${resourceId}`}>
          <strong id={`kiosk-review-${resourceId}`}>{reviewing === "issue_kiosk_credential" ? (active ? "Rotate this device credential?" : "Issue a device credential?") : "Revoke this device credential?"}</strong>
          <p>{reviewing === "issue_kiosk_credential" ? "The current secret will stop working immediately. The new secret will only be displayed once." : "The kiosk will no longer authenticate or receive a LiveKit token until a new credential is issued."}</p>
          <small>Recorded for {resourceName}: “{reason.trim()}”</small>
          <div>
            <button type="button" className="sv3-button sv3-button-quiet" disabled={busy} onClick={() => setReviewing(null)}>Go back</button>
            <button type="button" className={`sv3-button ${reviewing === "revoke_kiosk_credential" ? "sv3-button-danger" : "sv3-button-primary"}`} disabled={busy} onClick={() => void execute(reviewing)}>
              {busy ? "Verifying…" : reviewing === "revoke_kiosk_credential" ? "Confirm revocation" : "Confirm and continue"}
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className="sv3-kiosk-credential-error" role="alert">{message}</p> : null}
      <p className="sv3-kiosk-step-up-note">Credential changes require the facility permission and a fresh supervisor step-up. The app cannot create that proof in the browser.</p>
    </section>
  );
}
