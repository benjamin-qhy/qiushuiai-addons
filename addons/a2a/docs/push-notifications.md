# Optional durable push notifications

Push is **off by default**. Enabling it adds the A2A v1 Create/Get/List/Delete push-config methods, a durable notification worker and an authenticated receive-only inbox. It does not change core operation grants, enable agents, or allow arbitrary callback URLs.

## Operator policy

In Settings → A2A, configure the Push JSON field, then review and save. Existing configurations without `push` remain valid and disabled.

```json
{
  "enabled": true,
  "callbacks": [{
    "id": "partner-hook",
    "principal": "partner",
    "targets": ["summarise"],
    "url": "https://partner.example/events",
    "credentialKey": "a2a/partner-webhook",
    "allowPrivate": false,
    "enabled": true
  }],
  "receivers": [{
    "id": "lab-updates",
    "endpoint": "lab",
    "credentialKey": "a2a/lab-notifications",
    "enabled": true
  }]
}
```

Callbacks bind an exact canonical URL, authenticated principal, published target and local credential reference. A supplied URL must match that grant. Scheme changes, user info, fragments, queries, redirects and unapproved private addresses are rejected. DNS is checked and the chosen address pinned into the actual connection. Private addresses require deliberate `allowPrivate` permission, as for existing outbound endpoints.

Push registration uses standard `TaskPushNotificationConfig.authentication` with `scheme: "Bearer"` and a credential matching the operator-approved keychain entry. The incoming credential is compared and discarded; SQLite stores only the local reference. Config responses include the scheme but redact credentials. `token`, Basic/OAuth callback auth and anonymous callbacks are explicitly unsupported. This is a supported authentication profile, not a new wire convention for keychain names.

Receiver URLs are `/api/addons/a2a/push/<receiver-id>`. Receivers require a distinct keychain Bearer credential, enabled outbound endpoint and a task already recorded under that endpoint identity. They never enqueue model instructions or blindly accept pushed data as authoritative task state. Use the existing owned `get` action to reconcile current state with the peer. Notification receipt is acknowledgement, not model execution.

## Wire and ownership

Advertise `capabilities.pushNotifications: true` only when A2A/inbound/push are enabled and the runtime provides durable core events. Disabled calls retain `PushNotificationNotSupportedError`.

- Create: authenticate/authorise task, validate exact callback grant and credential, then commit callback and initial Task notification together. Client IDs may be supplied; otherwise generate one.
- Get/List/Delete: caller and published-target scoped. Pagination tokens are HMAC-protected and bound to principal/task/page size. Deletes revoke pending/inflight leases; revisions survive delete/recreate so old responses cannot acknowledge new callbacks.
- SendMessage may include a push config. Validate callback policy before admitting execution, then attach it to the durable task before core admission. Existing-task continuations do not mutate callback configuration; use the explicit CRUD methods.
- POST callbacks use `Content-Type: application/a2a+json`, standard `StreamResponse` JSON and the configured Authorization header. `A2A-Delivery-Id` is an optional implementation identifier for idempotent receivers, not a required A2A field.
- Task status and text-artifact events are enqueued in the same SQLite transaction as protocol-state updates. Core events are consumed independently of caller HTTP requests, so task polling or a live SSE subscriber is not required.
- Replay gaps use the current authorised core snapshot; model work is never re-executed to reconstruct notification history.

## Delivery limits and recovery

The single-owner worker checks at most 32 watched tasks and 8 due deliveries per cycle. It reads current core ownership before delivery and again after DNS/credential resolution immediately before connecting, then checks current callback policy and lease. Core access denial revokes the watch and queued deliveries, rather than retrying as a network fault.

At most four callbacks per task, 1,000 pending/inflight deliveries per principal, 256 KiB per payload, five attempts, 24-hour delivery expiry, 10-second per-attempt deadline and exponential delay capped at 60 seconds. HTTP 408/429/5xx and ambiguous transport failures are retryable; ordinary 4xx are terminal delivery failures. No error response body is retained as diagnostics.

Interrupted sends recover with the **same ID and payload bytes**. At-least-once delivery can repeat notifications; it is not exactly-once delivery. Leases reject late acknowledgements from older attempts. Config replacement/removal and shutdown abort active connections. Disable stops admission/worker activity without changing completed model task outcomes.

Notification capacity failures are recorded in aggregate diagnostics; oversized/full queues never roll back a primary completed task. Operators must reconcile these tasks using authenticated GetTask and adjust policy/limits. Delivery counters and failures appear in local diagnostics, not public task errors. Terminal task pruning removes callback/outbox state too; delivered/abandoned/revoked outbox rows expire separately.

Receivers allow eight active requests and 120 requests/minute per configured ID, a ten-second deadline and 256 KiB body. They reject duplicate JSON keys, unknown task IDs, multiple StreamResponse variants and conflicting replays. A supplied delivery ID is deduplicated by payload hash; peers without it use the payload hash as a bounded fallback. Receipt records contain hashes and task IDs, not notification bodies. Retention is seven days with 1,000 receipts per receiver; replay suppression is bounded by that retention window.

## Review and verification

Independent review identified and resolved permanent core-revocation handling and a final pre-connect ownership race; regressions revoke access during credential lookup and assert zero network. Another regression deliberately inserts an unapproved callback in the internal store and verifies policy prevents dispatch. Malformed callback auth produces a protocol error rather than a TypeError.

Tests cover transactional rollback, file-backed reopen, retries/expiry/stale leases, callback replacement, signed pagination, independent task completion without polling, redirect credential protection, slow/shutdown transport handling, receiver replay/revocation and retention. An independent Python A2A SDK 1.1.2 performs push CRUD against the real HTTP handler and validates callback payload/authentication at a raw webhook. A separate companion-core test exercises the real Piclaw route/operation/event APIs. No production endpoint or credentials are used.

See `push-implementation.md` for the current verification receipt. This optional feature remains distinct from card-signature trust; a signed card cannot authorise a callback.
