# Iroh implementation evidence

## 0.3.4 permission editor — 19 September 2026

- Remote Peer unit/security/loopback suite: 33 passed, 250 assertions; 16
  opt-in browser cases skipped there and run explicitly below.
- Explicit browser suite: 16 passed, 440 assertions. Unbundled add-on modules
  load through actual Classic/Visual Settings hosts at 1366, 820, 520 and 390px,
  plus older-host fallback fixtures. APIs are mocked; no live credentials/peers.
- File-only enable/disable preserves scope, modes and named agents. Tests cover
  Cancel/Revert without writes, invalid modes/confirmation, per-peer isolation,
  busy/double-Apply, readback failure, poll conflicts, and concurrent narrowing
  or re-pairing. The server compares saved policy and epoch under an immediate
  SQLite transaction before writing.
- Input tests check same-skin borders, padding, radius, labels and width bounds;
  the pane has no horizontal clipping at the tested widths.
- Real two-peer loopback browser flow passed pairing/approval, policy edits,
  file-only Apply/readback/reload and sender directory refresh. Receiver incoming
  files can be enabled while its outgoing advertisement still shows disabled.
- Remote Peer and compatibility TypeScript, standalone installation/import,
  catalogue/whitespace checks and package dry-run passed.

Run from the repository root with test isolation intact:

```sh
bun test addons/remote-peer
bun x tsc --noEmit -p addons/remote-peer/tsconfig.json
QIUSHUIAI_E2E_DISPOSABLE=1 QIUSHUIAI_SETTINGS_CORE_SOURCE=/absolute/path/to/qiushuiai \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/ms-playwright \
  bun test --timeout 25000 addons/remote-peer/permissions-browser.test.ts
QIUSHUIAI_E2E_DISPOSABLE=1 QIUSHUIAI_E2E_BROWSER=/absolute/path/to/chromium \
  bun --preload ./scripts/test-preload.ts addons/remote-peer/settings-pairing.browser.e2e.ts
```

Set an absolute `QIUSHUIAI_REMOTE_PEER_SCREENSHOT_DIR` to capture the editor from
the disposable browser fixtures. No production installation or network settings
were changed. This does not establish a fix for the separate missing-incoming-
pairing report. The historical network evidence below is unchanged.

## Initial transport validation

Local validation uses Bun 1.4.1, owned temporary state and explicit loopback sockets. No installed QiushuiAI state is read or modified. mDNS tests use injected fake services, not LAN advertisements.

Passing development checks:

- checksummed client IDs and strict legacy-setting rejection;
- fresh empty state, legacy-file sentinels unchanged, key persistence and permissions;
- real two-endpoint loopback Iroh pairing, explicit approval and ping;
- receiver-owned named-agent/mode/file policy, binary hashes and opaque replies;
- completed receipt deduplication, restart identity and revocation;
- signed-envelope tamper/replay/time/identity checks;
- wrong ALPN, ticket-ID mismatch and malformed/oversized frames;
- mDNS default-off, toggle cleanup, candidate limits, expiry and interface record filtering;
- direct Settings/transport registration with no peer HTTP routes.

Additional local evidence (Bun 1.4.1):

- Full repository suite after review fixes: 498 pass / zero fail, 3,005 assertions, including standalone package imports.
- Remote Peer focused tests: 20 pass / zero fail, 133 assertions after token-bound fixture ownership; lifecycle serialization, reply-epoch invalidation, mediated-result recovery and fixture ownership are covered.
- Isolated Chromium Settings fixture: client-ID entry, default-off mDNS/lookup and Iroh enable/disable passed; no live QiushuiAI target.
- Two ephemeral endpoints using n0 address lookup paired with bare client IDs, mDNS off, and pinged successfully. Both reached the EU n0 relay; selected data path was direct on the same host.
- Extracted 0.3.0 archive installed/imported with prebuilt native dependencies and lifecycle scripts disabled. No legacy HTTP modules were packaged.
- Remote Peer/root compatibility typecheck, catalogue validation and diff whitespace checks passed.

Further acceptance evidence:

- Real two-device mDNS: Smith LXC (`192.168.1.152`) and disposable `/tmp` process on VM 900 (`192.168.1.236`) joined `224.0.0.251`; Smith discovered the VM ID/address, sent a pairing request, VM accepted through its loopback control API, and one message was received. A raw multicast probe also passed bidirectionally. Both existing QiushuiAI services remained active; all temporary VM/local state was removed.
- Forced relay: two token-bound disposable containers ran on separate Docker networks. Both established the explicit EU n0 relay. Each namespace rejected UDP to the other endpoint's advertised direct address. Pairing and one message passed with Iroh reporting selected path `relay`; receiver count was one. Containers, networks and roots were removed by the fixture trap.
- Full isolated Settings pairing: pasted ID and ticket, recipient approval and restricted policy edit passed.
- Fresh and paired Settings screenshots were generated from actual temporary Iroh state.
- Independent read-only review identified lifecycle races, unbounded shutdown, reply-token epoch revival, mediated-result recovery and fixture ownership issues. Dedicated fixes/regressions cover them. Core shutdown API/deadline PRs #1285/#1288 merged green; exact add-on follow-up-head re-review remains required before merge.

Not yet live-verified: a custom authenticated relay and the full add-on installed in a complete disposable QiushuiAI Settings UI. Custom relay map and keychain reference handling have unit/type coverage. Previous HTTP release evidence was removed because it does not validate this protocol.
