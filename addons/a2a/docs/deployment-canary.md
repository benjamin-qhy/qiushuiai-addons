# A2A packaged deployment canary — 18 September 2026

The packaged core candidate and A2A add-on passed an explicitly authorised deployment test on **piclaw-test, VM 900, node radxax4**. The VM was restored to its original stopped state afterward. Smith's production runtime was not installed, restarted or enabled for A2A.

## Isolation and restoration

- Saved stopped snapshot `pre-a2a-20260918` before changes. Booted with its NIC disconnected; verified hostname/no logged-in users, stopped and temporarily disabled the old Piclaw and OpenCode proxy services, then restored network access for transfer.
- Installed a self-contained core portable artifact and the packed A2A add-on under `/opt/a2a-canary-20260918`, with dedicated `a2acanary` UID/home/workspace/Pi profile. No existing operator configuration or credentials were reused.
- Used a fresh encrypted keychain and disposable bearer credential. The deterministic OpenAI-compatible provider listened only on `127.0.0.1:18444`; core operations used a text-only grant with no tools.
- nftables restricted the dedicated UID to loopback and established replies. Two attempted new external packets were dropped; no paid/provider credentials existed in the test profile.
- Stopped test units, copied only nonsecret evidence, stopped the guest, rolled back snapshot `pre-a2a-20260918`, and verified `status=stopped`, `qmpstatus=stopped`, `net0=virtio=BC:24:11:47:E1:4E,bridge=vmbr0`. Original disks/config/services were restored by Proxmox; no test services were left running.

## Actual deployed results

| Check | Result |
|---|---|
| Default disabled installation | Status disabled; card 404; no task admission |
| Authentication/keychain | Authenticated card and RPC through actual host; missing bearer returns 401 |
| AgentPool/model execution | Task reaches completed through actual packaged AgentPool with loopback model; returned text matches request; no tools advertised |
| Deduplication | Identical message retry returns same task; provider log contains exactly one request |
| Cancellation | Held model request cancelled through A2A; terminal state CANCELED |
| SSE | Initial Task, artifact/status updates, terminal COMPLETED; three frames observed |
| Crash/restart | Killed actual runtime during held request; restart returns FAILED / interrupted_execution_unknown; same message retains same task ID, no blind replay |
| Persistence | Earlier completed task/result remains available after restart |
| Independent client | Python `a2a-sdk==1.1.2` discovers and completes a task through the actual runtime |
| Disable | Endpoint returns 404; no new admissions |
| Removal/reinstall | Removing package then restarting removes routes/web entry; task SQLite retained; reinstall starts disabled and preserves state |
| Actual Classic and Visual pane | Desktop 1366px and mobile 390px, zero browser errors and no horizontal content overflow |

## Deployment-discovered fix

The first real-host screenshot attempt found that A2A's web entry only exported a registration function and used `render`. Both host skins import web entries for side effects and require `component`. Corrected the module to self-register through `__piclaw_web` with `component`; changed the browser fixture to follow this actual loader contract. Both real skins then passed. This fix is included in add-on 0.2.2.

A first keychain setup attempt invoked the CLI module directly rather than the portable launcher; no entry was created. Using `bin/piclaw`, a fresh keychain master-key file and the disposable credential resolved it. No production secret was read or copied.

## Committed captures and receipt

- [Classic desktop](../assets/settings-microvm-classic-1366.png)
- [Classic mobile](../assets/settings-microvm-classic-390.png)
- [Visual desktop](../assets/settings-microvm-visual-1366.png)
- [Visual mobile](../assets/settings-microvm-visual-390.png)
- [Machine-readable checks](../assets/deployment-canary.json)

The test used actual packaged runtime execution, not a fake operation executor. The model itself was deterministic and local, so this does not claim paid-provider compatibility or a public Internet deployment. Incoming production publication still requires operator opt-in and independent core grants. Unsupported protocol transports/features remain as documented in the README.
