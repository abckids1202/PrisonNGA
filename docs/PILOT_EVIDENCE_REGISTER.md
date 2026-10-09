# SecureVisit Pilot Evidence Register

This register is the operational companion to the release gate evaluator. It
tracks the evidence required to move SecureVisit from repository-ready to an
institutionally approved staging or production pilot.

Every row must be completed by a named owner using real evidence from the
target environment. A green local test, a development adapter, or a planned
document is not evidence of completion. Do not put secrets, identity evidence,
prisoner data, or payment credentials in this file.

## How to use this register

1. Assign an owner and evidence ID before starting the test or approval.
2. Run the proof in the environment named in the row, using synthetic staging
   identities and sandbox accounts where applicable.
3. Store the artifact in the institution-approved evidence location and record
   only its reference, result, date, and expiry here.
4. Add the matching status to the deployment environment. The value must match
   the expected value in the release gate evaluator.
5. Re-run any evidence after material changes, expiry, provider changes, or a
   failed recovery exercise.

`NOT STARTED` is intentional for this repository template. It must be changed
only when the named owner has reviewed the artifact and the result is
reproducible.

## Evidence status

| Status | Meaning |
| --- | --- |
| `NOT STARTED` | No approved evidence exists. The gate is open. |
| `IN PROGRESS` | Work is scheduled or partially complete; it cannot satisfy a release gate. |
| `REVIEW` | Evidence exists and is awaiting owner, security, or institutional sign-off. |
| `VERIFIED` | Technical or operational proof passed and has an unexpired artifact. |
| `APPROVED` | A required policy, security, privacy, or release approval was signed by the authorized approver. |
| `EXPIRED` | Evidence was once valid but must be repeated before release. |

## Register

| Gate key | Required value | Environment | Owner | Required artifact and minimum proof | Review / expiry | Status | Evidence ID | Evidence date | Expires | Evidence location |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SECUREVISIT_RELEASE_APPROVAL` | `approved` | Production | Release owner | Signed release decision naming the version, facility, rollback owner, and open-risk disposition | Every release | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_SECURITY_REVIEW` | `approved` | Production | Independent security reviewer | Scope, methodology, findings, retest result, and accepted residual risks; no unresolved critical/high findings | Before pilot and after material security changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_PRIVACY_REVIEW` | `approved` | Production | Privacy / legal owner | Indonesian privacy and correctional-policy review covering purpose, access, retention, deletion, legal hold, visitor notice, and recording-off policy | Before pilot and after policy changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_TARIFF_APPROVAL` | `approved` | Staging + Production | Facility finance / policy owner | Approved Indonesian Visit Credit tariff, currency, tax treatment, effective date, and displayed visitor wording | On tariff change; before payment testing | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_REFUND_POLICY_APPROVAL` | `approved` | Staging + Production | Facility finance / policy owner | Approved cancellation, no-show, failure, expiry, dispute, and refund rules with staff authority limits | On policy change; before payment testing | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_BACKUP_RESTORE_DRILL` | `verified` | Staging + Production | Database / platform owner | Remote D1 backup, restore into an isolated database, schema/FK/ledger/audit integrity checks, measured RPO/RTO, and sign-off | At least quarterly and after backup-process changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_WAF` | `enabled` | Staging + Production | Platform / security owner | Deployed WAF and bot/rate-limit rules; test results for OTP, token, webhook, login, and abuse paths; false-positive review | Monthly and after rule changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_MONITORING` | `configured` | Staging + Production | SRE / operations owner | Dashboards and alerts for errors, latency, auth abuse, queue/outbox failures, provider failures, stale sessions, and database health; acknowledged test alert | Monthly and after monitoring changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_OUTAGE_RUNBOOK` | `approved` | Staging + Production | Incident commander | Approved runbooks for identity, payment, email/SMS, LiveKit, D1/R2, kiosk, and deployment rollback; tabletop exercise record | Quarterly and after incidents | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_IDENTITY_STAGING` | `verified` | Staging | Identity owner | OIDC and SAML login, institutional MFA, claims/facility mapping, disabled-account denial, session revocation, step-up action, and audit evidence | Before each pilot release and after IdP changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_PAYMENT_STAGING` | `verified` | Staging | Payments owner | Sandbox checkout, signed webhook, duplicate/replay handling, expiry, refund, dispute/chargeback simulation, reconciliation, and ledger verification | Before each payment release and after provider changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_NOTIFICATION_STAGING` | `verified` | Staging | Communications owner | Real provider delivery, bounce/invalid-recipient handling, retry/backoff, dead-letter, replay, unsubscribe/consent behavior, and outage recovery | Before each notification release and after provider changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_EVIDENCE_STAGING` | `verified` | Staging | Security / storage owner | Private R2 upload, malware quarantine/rejection, authorized access, denied access, retention purge, legal hold, access log, and restore test | Before pilot and after storage/scanner changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_KIOSK_STAGING` | `verified` | Staging | Facility device owner | Hardware enrollment, device identity, credential rotation/revocation, replacement, offline/reconnect recovery, camera/mic/network checks, and audit trail | Before pilot and after kiosk image/firmware changes | `NOT STARTED` | — | — | — | — |
| `SECUREVISIT_LIVEKIT_STAGING` | `verified` | Staging | Video / operations owner | Visitor, kiosk, and staff observer join; token scope/expiry; presence; reconnect; provider disconnect; expiry; staff termination; completion settlement; audit and notifications; recording remains disabled | Before each video release and after LiveKit changes | `NOT STARTED` | — | — | — | — |

## Production manifest mapping

Production readiness also requires the release-evidence manifest referenced by
`SECUREVISIT_RELEASE_EVIDENCE_MANIFEST`. The manifest must use the exact gate
keys above, the same release ID as `SECUREVISIT_RELEASE_EVIDENCE_ID`, and a
future expiry matching `SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT`.

Use this shape as a redacted example; replace placeholders only in the secret
deployment configuration and approved evidence system:

```json
{
  "releaseId": "<release-evidence-id>",
  "expiresAt": "<future-iso-timestamp>",
  "gates": {
    "SECUREVISIT_RELEASE_APPROVAL": {
      "status": "approved",
      "evidenceId": "<artifact-id>",
      "expiresAt": "<future-iso-timestamp>"
    },
    "SECUREVISIT_SECURITY_REVIEW": {
      "status": "approved",
      "evidenceId": "<artifact-id>",
      "expiresAt": "<future-iso-timestamp>"
    }
  }
}
```

The evaluator still requires every production gate to be present and valid;
the shortened example above is not a usable production manifest.

## Current interpretation

Until this register has real owners, artifacts, dates, and approvals, the
correct project status remains “strong persisted prototype, not an
institutional pilot.” The register does not grant approval and does not replace
the staging acceptance runbook, independent review, or institutional sign-off.
