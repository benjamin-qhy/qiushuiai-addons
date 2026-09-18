# Push candidate validation — 18 September 2026

Issue #129 adds opt-in push after card discovery PR #133. Push defaults off; no operator configuration, production listener or credential was changed during implementation. The callback profile and limits are in [push-notifications.md](push-notifications.md).

## Gates

| Gate | Result |
|---|---|
| Strict compatibility typechecks | Passed |
| Complete explicit A2A suite | 81 passed, 588 assertions across 20 files |
| Repository compatibility suite | 213 passed, 8 explicit integration skips (tested in complete run) |
| Broad repository unit suite | 586 passed, 8 explicit integration skips |
| Standalone A2A install/import | Passed with own installed dependencies |
| Scoped lint, catalog, whitespace, package dry-run | Passed; 52 files, about 0.91 MB unpacked |

The compatibility run initially exposed a fixed 700 ms timing assumption in the service lifecycle test during a concurrent dependency install. It now waits for actual delivery under a five-second bound; the disable/no-more-deliveries assertions are unchanged. The serial full gate passed.

## Independent review

A separate judge reviewed policy, worker and receiver. Findings and resolutions:

- Treat core `OperationAccessError` as permanent revocation, not a network retry. Watches/configs/pending sends are revoked; unrelated work still advances.
- Check current core ownership again after asynchronous DNS and credential setup, immediately before connection, then synchronously recheck outbox lease and callback policy. Regression revokes during the resolver and confirms zero network requests.
- Validate callback auth types before lowercase/credential comparison. Malformed objects return `RequestMalformedError`.
- The internal store is not a trust authority. A regression bypasses registration and inserts an unapproved callback directly; dispatch revalidation refuses it and revokes the watch.

The follow-up judge confirmed the reported auth-race and type-handling blockers resolved. Networking remains subject to exact operator grants, fresh credentials, DNS pinning, redirect rejection and per-attempt deadlines.

## Executable evidence

- `push-store.test.ts`: principal ownership, config revisions/tombstones, event-ID conflicts, transactional rollback, leased settlement, file-backed reopen, stable retry ID/bytes, attempts and expiry.
- `push-delivery.test.ts`: standard JSON-RPC CRUD/capability gates, credential redaction, signed pagination, multi-callback isolation, revocation, redirect security, malformed auth, no task polling and delivery failure without task rollback.
- `push-receiver.test.ts`: credential checks, expected remote-task correlation, duplicate/conflicting replay, endpoint replacement, stalled-body cancellation and persistence across reopen. No notification is sent to a model or used as authoritative task state.
- `push-lifecycle.test.ts`: real stalled HTTP callback cancellation, same-ID retry on restart, real service enable/disable/shutdown with no continuing sends.
- `python-push-peer.test.ts` / `python-push-peer.py`: independently maintained Python A2A SDK 1.1.2 creates/gets/lists/deletes a config over HTTP; a raw webhook confirms Bearer authentication, `application/a2a+json`, task identity and terminal StreamResponse without task polling.
- `host-integration.test.ts`: actual Piclaw external route registry, operation service and durable event API in an explicitly isolated companion process. Push arrives before GetTask is called; fake executor only, no provider costs.
- `settings-browser.test.ts`: actual side-effect registration and component contract, both skins at desktop/mobile sizes, reviewed enablement and immediate disable. The settings pane includes a separate push JSON policy field.

## Reproduce

```sh
bun install --frozen-lockfile
bun run typecheck:earendil-compat
bun run test:earendil-compat
bun test standalone-import.test.ts --test-name-pattern a2a
```

Explicit complete suite (companion core source must implement the merged generic operations API):

```sh
PICLAW_E2E_DISPOSABLE=1 \
PICLAW_A2A_CORE_SOURCE=/absolute/path/to/piclaw \
PICLAW_A2A_PYTHON=/absolute/path/to/python-with-a2a-sdk \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/ms-playwright \
  bun test --timeout 15000 addons/a2a
```

Python environment: `a2a-sdk==1.1.2`, `rfc8785==0.1.4`, cryptography. Tests use disposable local credentials/loopback servers. None contacts production peers or boots the test VM. The earlier 0.2.2 deployment receipt is historical evidence and is not presented as a push deployment test.

## Supported-profile limits

Bearer callbacks must match operator-approved URL/credential refs. The optional `token` field, Basic/OAuth callback auth, dynamic callback trust, signed push payloads, and remote key retrieval are unsupported. Receipt deduplication is bounded to seven days; at-least-once transport retries can repeat payloads. Receiver acknowledgements only record task correlation/hash; users reconcile through owned GetTask. Push failure never changes a completed model task. Notification capacity failures are explicit diagnostics, not proof of delivery.

Merge was authorised subject to review and passing local gates. Production enablement remains a separate operator action. The initial epic and discovery work are not reopened by this optional follow-up.
