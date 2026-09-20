# A2A service candidate validation

The service candidate builds on A1's disabled SDK/profile package and QiushuiAI's generic operation foundation PR #1337. Neither implementation is installed or enabled in production. Tests use isolated filesystem preloads, disposable loopback listeners and fake executors; no provider or live operator agent is called.

## Reproducible evidence

| Surface | Executable checks |
|---|---|
| Protocol/SDK baseline | `sdk-http.test.ts`: raw v1 JSON, official client, default/immediate send, Task-first SSE, unsupported/malformed/media/body cases and safe error redaction |
| Principal/egress | `security.test.ts`: bearer-only auth, revocation, references-only config, target scope, all-address validation, pinned actual lookup, redirect refusal and no cookies/foreign auth |
| Persistence | `task-store.test.ts`: reopen, caller/context isolation, conflicting message IDs, terminal immutability, retention and uncertain continuation refusal |
| Inbound mapping | `handler.test.ts`: task ownership, canonical card auth shape, durable operation mapping, blocking/immediate results, continuation, signed/filter-bound pagination and truthful cancel |
| HTTP lifetime | `server.test.ts`: actual HTTP with official JS client; idle read/cancel/shutdown/stalled bodies; quotas; consumers never own execution cancellation |
| Outbound | `client.test.ts`: independently hand-written v1 peer, send/get/cancel/subscribe, dedup, unknown outcomes across reopen and endpoint-replacement isolation |
| Parts/artifacts | `parts.test.ts`: text/JSON/UTF-8 inline files, decoded bounds, URI/binary/legacy/traversal rejection and bounded incremental artifact assembly |
| Runtime lifecycle | `service.test.ts`: missing/old host APIs fail closed, disabled startup creates no task database, route ownership/removal, family guard, config validation and disable |
| Actual core integration | `host-integration.test.ts`: separate process imports explicit companion core; real route registry + durable operations, one admission for duplicate sends, public result/HTTP auth/protocol field presence |
| Independent SDK | `python-peer.test.ts` + `python-peer.py`: separately maintained **Python a2a-sdk 1.1.2**, discovery/send/dedup/get/cancel/SSE over actual HTTP |
| Operator UI | `settings-browser.test.ts`: actual pane in disposable host-style fixture; Classic/Visual at 1024 and 390 pixels, grant confirmation, disable, no overflow/errors |

Run unit/type/catalog checks from repository root:

```sh
bun install --frozen-lockfile
bun run typecheck:earendil-compat
bun run test:earendil-compat
bun test standalone-import.test.ts
bun test addons/remote-peer
bun run check:catalog
cd addons/a2a && bun pm pack --dry-run
```

The broad repository test run needs existing per-package runtime dependencies installed (notably observability); no unrelated dependency/lock changes should be committed.

The explicit integration/browser companion is never the running installed runtime:

```sh
QIUSHUIAI_E2E_DISPOSABLE=1 \
QIUSHUIAI_A2A_CORE_SOURCE=/absolute/path/to/qiushuiai-candidate \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/ms-playwright \
  bun test addons/a2a/host-integration.test.ts addons/a2a/settings-browser.test.ts
```

Independent Python client is a test-only optional environment, not an add-on runtime dependency:

```sh
uv venv /tmp/a2a-python-peer
uv pip install --python /tmp/a2a-python-peer/bin/python a2a-sdk==1.1.2
QIUSHUIAI_E2E_DISPOSABLE=1 QIUSHUIAI_A2A_PYTHON=/tmp/a2a-python-peer/bin/python \
  bun test addons/a2a/python-peer.test.ts
```

## Verified results so far

- All compatibility typechecks passed.
- Complete A2A run with all explicit companion/browser/Python cases enabled: **44 passed, 391 assertions**. No skipped A2A acceptance cases in that run.
- Broad repository unit run (excluding duplicate standalone imports and e2e entrypoints): **550 passed, 6 explicit integration skips**. Those six cases passed in the complete A2A run.
- Compatibility suite: **176 passed** at the preceding candidate; final strict compatibility typechecks passed.
- 29 standalone package import tests passed.
- Five actual-host/browser cases and the independent Python SDK case passed.
- Seven stable acceptance scenarios in `docs/acceptance.feature` map to executable tests; no step-binding claim.
- Changed-file lint, catalog, whitespace and package dry-run passed: 32 files, about 0.46 MB unpacked; docs, licensed schema and four screenshots included.
- Companion core full `make ci-fast`: **5,380 runtime passes, 4 skips; 25 feature checks; 9 builds** after the outbound-work admission and continuation-review follow-ups, against current main/Earendil 0.85.1.
- The service remains fail-closed when the core operation API is absent. Package includes no core runtime/source imports outside explicit companion-source test fixtures.

The HTTP review now counts authentication setup within the global concurrency cap and bounds request waits while retaining a cap on uncooperative credential-provider promises. A regression saturates the provider, cancels all waiters and verifies no unbounded replacement lookups.

## Known limits and release gates

- The explicitly approved [packaged deployment canary](deployment-canary.md) passed on VM900/radxax4, including actual model execution, restart/dedup/cancel, independent Python and both-skin UI. It found/fixed real web-entry registration; the original fixture now follows the host contract. Snapshot `pre-a2a-20260918` was restored and verified stopped afterward.
- A2A core and add-on grants are separate. The authenticated add-on exposes only configured targets, while core rechecks operation authority. Tool grants retain process/filesystem authority; this is not a sandbox.
- Inbound artifacts are the core's bounded public text. JSON and UTF-8 inline input files are supported within the advertised textual profile; URI fetching, arbitrary binary files and standalone download URLs are deliberately unsupported.
- Client task ownership uses the verified current core budget-work ID plus endpoint URL/credential reference. Each network request rechecks host work admission; paused/exhausted or missing work fails closed. Remote provider billing remains unknown and is not represented as local model usage.
- Reconnect is snapshot/status reconciliation, not invented SSE replay guarantees. Incremental artifact duplicates without a protocol sequence cannot be guessed away.
- Unknown sends/continuations require operator or peer reconciliation rather than automatic replay of potentially side-effecting work. No distributed leases or exactly-once side-effect claim.
- This evidence proves tested local contracts and independent SDK/wire compatibility. The packaged canary adds actual isolated runtime deployment evidence. Neither test grants permission to enable production/public networking.

Merge approval was explicitly given after the isolated deployment gate. The first-release epic closes only after the approved PRs merge and final issue/evidence links are verified. Optional root discovery/card signing and push notifications are not initial-release blockers.
