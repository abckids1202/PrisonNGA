# SecureVisit evidence storage — staging acceptance

This checklist proves that visitor verification evidence is stored privately, scanned before staff use, facility-scoped, retained, and recoverable. Use synthetic documents only. A configured R2 bucket or scanner without this evidence is not a pilot-ready control.

## Required staging configuration

```text
EVIDENCE_STORAGE_PROVIDER=r2
EVIDENCE_BUCKET=<private staging R2 binding>
EVIDENCE_BUCKET_NAME=<staging binding name>
EVIDENCE_SCAN_PROVIDER=webhook
EVIDENCE_SCAN_WEBHOOK_URL=https://<scanner-relay>/scan
EVIDENCE_SCAN_WEBHOOK_SECRET=<staging secret>
EVIDENCE_SCAN_CALLBACK_URL=https://<securevisit-staging>/api/webhooks/evidence-scan
EVIDENCE_RETENTION_DAYS=<approved staging value>
```

Keep identity evidence in a bucket separate from recordings. Disable public bucket access, public object URLs, directory listing, and browser-direct credentials. The scanner relay must use a separate staging credential and must not log file contents or evidence metadata beyond the approved correlation fields.

## Upload and scan contract

1. Visitor uploads a synthetic JPEG, PNG, or PDF through the authenticated visitor route.
2. SecureVisit validates byte size, content type, and file signature before sending the scan request.
3. The scanner relay verifies the signed request and idempotency key, scans the content, and returns either:
   - `clean` for a synchronous clean result;
   - `accepted`/`pending` plus a provider reference for asynchronous scanning;
   - an explicit infected or failed result.
4. A pending upload is stored in the private R2 bucket and remains `QUARANTINED`; it must never be available to staff until a signed clean callback is persisted.
5. The callback must include a stable event ID, provider reference, verdict, and matching SHA-256 when available. It must be timestamped and signed using the scanner secret.
6. A clean callback transitions the exact document to `AVAILABLE`; an infected or failed callback keeps it unavailable and records an auditable reason.

## Acceptance matrix

Record release ID, facility ID, document ID, scan reference, event ID, request/correlation IDs, object key, and resulting database state. Never record document contents, visitor identity evidence, or secrets.

| Scenario | Expected result |
| --- | --- |
| Valid synchronous clean result | R2 object and database row are created; status is `AVAILABLE`; staff access is allowed only through the authorized route. |
| Valid asynchronous result | Row is `QUARANTINED`/`PENDING`; staff access is denied until a clean callback. |
| Clean callback | Matching document becomes `AVAILABLE` once; audit/outbox records are created. |
| Infected callback | Object remains inaccessible or is quarantined for purge; document is not available to staff; incident/privacy signal is created. |
| Scanner timeout/5xx | Upload fails closed or remains explicitly quarantined; no false clean result; retry is safe. |
| Invalid content signature | Rejected before storage or scan submission. |
| Wrong SHA-256 callback | Rejected; document state is unchanged. |
| Invalid callback signature/stale timestamp | 401; no database or object-state mutation. |
| Duplicate identical callback | Idempotent success; no duplicate state transition or notification. |
| Same event ID with different payload | Replay conflict; original callback remains authoritative. |
| Duplicate upload with same idempotency key/digest | One logical document and one object; safe replay response. |
| Cross-facility staff read | Denied, with no object existence leak. |
| Visitor tries staff evidence route | Denied and audited. |
| Missing R2 object or digest mismatch | Read fails closed; no evidence is presented as valid. |

## Retention, legal hold, and recovery

1. Set a short synthetic retention deadline and run the retention worker. Confirm the database enters its recoverable deletion state before the R2 delete, and that a failed delete creates a durable alarm and can be retried.
2. Place the document on legal hold and rerun retention. Confirm neither the database row nor the R2 object is deleted.
3. Remove the legal hold only through the authorized staff workflow and verify the action is audited.
4. Restore a staging R2 object and its D1 metadata into an isolated recovery target. Verify the digest, facility scope, retention deadline, legal-hold state, and access audit before declaring recovery successful.
5. Test an R2 outage and confirm uploads/reads fail closed without exposing public URLs or falsely completing verification.

## Go/no-go evidence

The evidence-storage gate is accepted only when the evidence register contains:

- private-bucket configuration and denied-public-access proof;
- clean, pending, infected, timeout, and malformed-callback results;
- signed callback and replay-conflict results;
- staff-authorized read and cross-facility denial evidence;
- retention deletion and legal-hold evidence;
- R2/D1 isolated restore verification with measured RPO/RTO;
- scanner, storage, and recovery owners with incident contacts;
- confirmation that all test files are synthetic and have been deleted or retained under the approved staging schedule.

This acceptance does not approve real identity documents, a production retention schedule, or legal policy. Those require institutional privacy and correctional-policy approval.
