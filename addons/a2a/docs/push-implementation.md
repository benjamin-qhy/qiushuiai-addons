# Push notification implementation checkpoint

Issue #129 is in progress. **No push method, dispatcher or receiver is enabled.** `pushNotifications` remains false and existing unsupported-method errors remain intact. This work is separate from optional card trust in PR #133.

## Implemented internal foundation

`push-store.ts` provides protocol-independent delivery state over a caller-owned Bun SQLite connection. It must be constructed with the same database as task persistence, so a task-event transition and outbox enqueue can share one transaction.

- Principal/task/config-owned callbacks store only operator-vetted URL and credential references. The future wire handler must authenticate the principal, validate the task and map callback auth to operator policy before calling the store.
- Configuration revisions survive deletion/recreation; changing or deleting a configuration revokes its pending/inflight attempts.
- Stable delivery ID, event ID, exact payload bytes/hash and callback revision form the durable dispatch record. Reusing an event ID with different bytes fails.
- Claim/settlement leases stop stale workers from acknowledging a newer attempt or a revoked/replaced callback.
- Recover uncertain sends as the same delivery ID/bytes. At-least-once duplicate notifications are possible; receivers must deduplicate. This does not resubmit the model operation.
- Five attempts maximum, exponential delay capped at 60 seconds, 24-hour expiry, four callbacks per task, 1,000 pending/inflight deliveries per principal and 256 KiB payload limit.
- Transaction rollback tests prove task/outbox composition can be atomic. File-backed close/reopen tests verify crash recovery and stale-lease rejection.

Validation at checkpoint: strict A2A typecheck, scoped lint, and three outbox tests / 29 assertions pass. No network calls or production database access.

## Next required work

1. Decide and document the wire-authentication profile: the pinned spec uses `AuthenticationInfo.scheme/credentials`, but externally supplied credential values must not be persisted or logged. Map only operator-approved callbacks/credential refs and reject unapproved credentials/URLs; do not invent secret-ref wire semantics.
2. Wire principal-owned Create/Get/List/Delete config methods to the task store. Make feature capability opt-in and fail closed. Validate terminal/deleted task and pagination behaviours.
3. Enqueue every supported status/artifact event atomically with task changes, independently of polling/HTTP subscribers. Reconcile generic core operation events on restart without missing completion notifications.
4. Add an abortable bounded dispatcher through the pinned-address egress transport: current grants/credential rotation/revocation checked on each attempt, redirects forbidden, response/time limits, durable retries, no task-state corruption on callback failure.
5. Add authenticated receiving/replay policy and expected-task correlation. Independent peer tests must verify exact `StreamResponse` JSON and `application/a2a+json`, receiver idempotency and authorised task reconciliation.
6. Add settings/diagnostics, retention cleanup, lifecycle shutdown, migration tests, standalone packaging and complete negative/independent integration evidence before exposing `pushNotifications: true`.

The initial A2A epic remains complete; #129 stays open. This checkpoint is not release acceptance, merge approval or permission to enable networking.
