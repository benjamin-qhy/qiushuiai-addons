# A1 validation evidence

Validated on 17 September 2026 with Bun 1.4.1 on Linux in an isolated add-ons worktree based on `b8e2659`. No production runtime, provider, credentials or network endpoints were used. SDK HTTP fixtures bind ephemeral `127.0.0.1` ports and stop after their tests.

| Gate | Result |
|---|---|
| `bun run typecheck:earendil-compat` | Passed, including strict A2A test/source typecheck |
| `bun run test:earendil-compat` | 150 passed, including 10 A2A tests |
| `bun test standalone-import.test.ts` | 29 passed; A2A imports from a separate directory with installed dependencies |
| `bun test addons/remote-peer` | 28 passed |
| Broad unit run, excluding e2e entrypoints and standalone import repeat | 523 passed across 78 files |
| `bun run check:catalog` | Passed; public tarball URL and declared skill/runtime preserved |
| `bun pm pack --dry-run` in add-on directory | Passed; package includes profile, adapter, docs, skill and licensed protobuf snapshot; no test files or node_modules |
| Changed-file oxlint / `git diff --check` | Passed |

The broad unit run initially lacked the existing observability add-on's runtime dependencies. Installing those dependencies only inside the isolated worktree resolved that setup failure; no observability source/manifest/lock changes are included.

## Executable findings

`addons/a2a/sdk-http.test.ts` exercises official SDK client ↔ framework-free SDK JSON-RPC handler, plus hand-authored v1 wire requests:

- explicit card discovery and `A2A-Version: 1.0`;
- direct Message and Task result envelopes, enum/oneof encoding and absent default fields;
- default-blocking SendMessage and explicit immediate receipt, followed by precise fixture cancellation;
- Task-first response SSE and terminal status delivery;
- malformed JSON/envelopes, 0.3 and unsupported versions, foreign tenant, invalid role/configuration, legacy/file parts, unsupported push/extended-card methods, media and body limits;
- consumer cancellation does not invoke executor cancellation, but the SDK demo store remains WORKING despite completed execution. This limitation is asserted, not hidden by treating iterator closure as durable task completion.

`index.test.ts` checks no network calls or execution actions, bounded status output, fail-closed runtime diagnostics, skill paths, and the pinned schema hash/SDK version. `standalone-import.test.ts` checks the package outside the monorepo.

## Decision

Use the official SDK client, generated protobuf codecs and error definitions. Keep `DefaultRequestHandler`/`InMemoryTaskStore` fixture-only. Later slices must provide principal policy, durable operation admission, independent event persistence, truthful cancellation and cooperative abortable subscriptions. Idle SDK stream cancellation is not yet a production-ready path.

This evidence does not complete the A2A epic or establish interoperability with a second implementation. The first package is deliberately diagnostic-only; no operator setting can enable work. No raw enqueue fallback or remote-peer transport registration exists.
