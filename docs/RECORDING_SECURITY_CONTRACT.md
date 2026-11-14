# SecureVisit recording security contract

This contract describes the implementation boundary for governed recordings. It is a technical control description, not proof that a deployment has been configured or approved.

## Storage

- LiveKit Egress writes directly to a dedicated private R2 recordings bucket through the S3-compatible endpoint.
- The bucket must be separate from identity-evidence storage and must not be public.
- Production startup fails unless `RECORDING_STORAGE_PROVIDER=livekit_r2`, `RECORDINGS_ENCRYPTION_MODE=r2_managed`, the recordings bucket, the R2 endpoint and credentials, and `RECORDINGS_ENCRYPTION_KEY_REFERENCE` are present.
- R2-managed encryption at rest is the required storage control. LiveKit's current `S3Upload` contract does not expose customer-managed SSE/KMS fields, so this is explicitly an R2-managed control rather than a claim of application-managed encryption. The encryption control reference must be a bounded identifier containing only letters, digits, `.`, `_`, `:`, `/`, and `-`; it is persisted with the recording and attached as object metadata. Key material is never stored in D1, logs, or browser responses.
- The LiveKit upload identity must be write-scoped to the recordings bucket and must not be reused for visitor playback.

## Access

- Staff playback is served through the facility- and organization-scoped Worker route; raw R2 URLs are never returned.
- Playback verifies object size and SHA-256 integrity before streaming.
- Every playback, including approved break-glass playback, creates an append-only access event with actor, facility, organization, correlation, and reason fields.

## Lifecycle

- Recording consent and facility policy are required before recording starts.
- Each recording receives a retention deadline from the persisted facility policy.
- Legal holds prevent deletion until released.
- Retention deletes the private object before final database removal and records the outcome for reconciliation.
- Recording provider failures remain visible and retryable; a failed callback cannot silently create an available record.

## Required staging evidence

The `SECUREVISIT_LIVEKIT_STAGING=verified` evidence must include:

1. A synthetic visitor, kiosk, and staff observer in one LiveKit room.
2. Consent and policy enforcement.
3. Private R2 object creation and metadata verification.
4. Unauthorized playback denial and authorized playback audit evidence.
5. Integrity verification, retention deletion, and legal-hold behavior.
6. Provider retry and recording-failure recovery.

Local tests verify the control boundaries only. They do not replace the staging storage, provider, or institutional approval evidence.
