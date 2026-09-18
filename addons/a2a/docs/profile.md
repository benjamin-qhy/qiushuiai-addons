# A2A v1 wire profile

A1 validates a disabled integration foundation. The method matrix below distinguishes tested disposable SDK behaviour from future production capability. Cards in tests are fixtures, not published operator agents.

## Version and encoding

| Item | Rule |
|---|---|
| Specification | A2A v1.0.1; committed protobuf is the field-level source |
| HTTP header | Explicit `A2A-Version: 1.0`; absent, 0.3, 1.1 and patch-valued headers rejected |
| Binding | JSON-RPC 2.0 over HTTP(S), POST; GET for explicit card discovery |
| Names | `SendMessage`, not legacy `message/send` |
| Request media | `application/json` or `application/a2a+json` |
| Response media | JSON-RPC `application/json`; streamed `text/event-stream` with `data: <JSON>\n\n` |
| JSON fields | Protobuf lowerCamelCase, enum names such as `ROLE_USER` and `TASK_STATE_COMPLETED`; absent/default fields follow generated codecs |
| Unknown fields | Ignore forward-compatible unknown message fields after validating supported identity/role/parts; reject wire-supplied tenant |
| SDK objects | Internal numeric enums and oneof `{ $case, value }`; use SDK fromJSON/toJSON at the boundary, never transmit these internal unions |
| Parts | A1 text-only; no legacy `kind`, arbitrary data, raw bytes or URI retrieval |
| Input limits | 32 KiB body, bounded while reading regardless of Content-Length |
| Output limits | 256 KiB JSON/frame; 2 MiB stream; one requested frame per consumer pull |

## Send semantics correction

The v1.0.1 Markdown prose says immediate task return, but its normative protobuf `SendMessageConfiguration.return_immediately` states **false by default and blocking** until terminal/interrupted. The SDK implements that protobuf rule. Tests use `configuration.returnImmediately: true` explicitly for background task receipts and verify the omitted/default case waits for completion. Server implementation must honour both modes and apply a bounded transport deadline without interpreting disconnect as task cancellation.

## Method/capability matrix

| Method | A1 fixture | Production gate |
|---|---|---|
| SendMessage | Raw wire and official client; direct Message; blocking Task and immediate active Task | A2 policy, C1 admission, A3 task store, A5 server |
| SendStreamingMessage | Official client consumes Task then terminal status via SSE | C2 public events, A6 subscription lifecycle/backpressure |
| GetTask / CancelTask | Query and cancellation of explicit immediate task | Owner-scoped store and precise core operation cancellation |
| ListTasks | SDK dispatch available; pagination/ownership tests land with A3 | Principal-scoped pagination/history/retention |
| SubscribeToTask | SDK dispatch available; production idle-abort handling unresolved | Snapshot/replay/revocation and bounded idle cleanup in A6 |
| Push-config methods | Explicit `-32003` unsupported | Optional A11 only |
| GetExtendedAgentCard | Explicit `-32004` unsupported | Optional A10 only |
| gRPC / REST / 0.3 | Excluded | No first-release implementation |

Errors tested: parse `-32700`; invalid envelope `-32600`; method `-32601`; params `-32602`; push `-32003`; unsupported operation `-32004`; content `-32005`; version `-32009`. Wrong HTTP method returns 405/Allow, unsupported media 415, body-limit failure 413. Later policy maps unauthorised access at HTTP and task levels without leaking caller/task existence.

## SDK choice and limitations

The SDK provides a framework-independent `JsonRpcTransportHandler.handle` and native fetch client, so Piclaw needs no Express/gRPC dependency. All A2A imports stay in the add-on. The official generated codecs normalise data but do not replace security/schema validation of untrusted JSON.

`DefaultRequestHandler` and `InMemoryTaskStore` are fixture-only. The default handler can mark a task cancelled when its event bus has disappeared without calling an underlying executor cancellation. The fixture keeps WORKING buses using the **numeric** TaskState enum and checks that cancellation reaches the executor. Production will use C2's truthful cancel result.

A verified consumer-disconnect test also shows the demo store can remain at WORKING after the executor completes: the stream consumer owns result processing, and its closure stops persistence. Production must persist terminal events independently of subscribers and reconcile them after restart. The regression asserts the executor finished, task cancellation was not called, and the demo store still has WORKING.

SDK stream queues await new events and do not observe HTTP AbortSignal. Returning a pending async iterator alone cannot reliably interrupt an idle subscription. A6 must use a cooperative, principal-scoped public-event source with abort/unsubscribe and owned task persistence; it must not ship the demo event bus as a durable task system. Finite fixture streams close their buses, listeners and server, and cancellation tests distinguish task cancel from consumer stop. The HTTP adapter is not registered on the host in this milestone.

## Required next security gates

No private target discovery, A2A credential state, remote URI fetch, authenticated publication or execution has been enabled. A2 adds verified principals/endpoint policy; C1/C2 must enforce target/work/budget lineage independently; A3 owns protocol persistence. Disabling must stop new admission and define active-work handling. Family/isolated access remains denied and Remote Peer's bang transport remains untouched.
