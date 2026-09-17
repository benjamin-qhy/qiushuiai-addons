# A2A add-on — profile validation

This package currently registers only read-only `a2a` status/profile actions. **Agent calling and publication are disabled.** Installation opens no listeners, registers no HTTP routes, changes no credentials and creates no task database.

This is the A1 profile/SDK milestone of [epic #118](https://github.com/rcarmo/piclaw-addons/issues/118), tracked in [#119](https://github.com/rcarmo/piclaw-addons/issues/119). Core operation admission/results, endpoint/principal policy, task persistence, execution tools and operator enablement are separate dependent slices. Unsupported runtimes cannot enable work; there is no fallback to raw enqueue or operator-session execution.

## Evaluated profile

- Normative source: A2A 1.0.1 protobuf at `3303592588e388e62e0f69f701af531d2f4e3991`; offline copy, hash and Apache licence in [protocol/](protocol/provenance.json).
- Evaluated SDK: `@a2a-js/sdk@1.1.0` (Apache-2.0), exact direct dependency. Repository lock pins transitive versions/integrity. No Express, gRPC, Protobuf runtime or Pi implementation packages are bundled.
- Wire version: `A2A-Version: 1.0`. JSON-RPC v1 PascalCase methods and protobuf JSON mapping. Explicit configured Agent Card URL under `/api/addons/a2a`; no root-path requirement or legacy 0.3 adapter.
- Response SSE for streaming; text-only fixture data. See [the method/data matrix](docs/profile.md) for limits and excluded capabilities.

The SDK client and framework-free JSON-RPC handler run on Bun 1.4.1 with ephemeral loopback fixtures. Tests cover raw and official-client requests, direct messages, default-blocking and explicit immediate task receipts, cancellation, SSE and malformed/unsupported cases. They invoke no provider or live Piclaw server. This is compatibility evidence, not production authentication, durability or independent-implementation conformance.

The SDK server demo stores and execution bus do not meet Piclaw's durable operation requirements. Use the SDK client/codecs; own the production request handler/task store and scoped subscription lifecycle in later slices. A client socket closing must never turn into broad agent/session cancellation.

## Run checks

From the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck:a2a
bun test addons/a2a
bun run check:catalog
bun test standalone-import.test.ts
```

The repository/test-directory preload isolates workspace, database, home and credentials. Test HTTP listeners bind `127.0.0.1` on OS-assigned ports and are stopped after the suite. No remote agent URL or credential is required.

## Installation boundary

First-party distribution remains the public GitHub Pages tarball catalog. This staged version is a disabled diagnostic package; a future version will add explicit operator settings. The manifest's Piclaw minimum permits status-only loading; enabling execution will additionally require the versioned core capabilities from core #1335/#1336. Merely having a runtime global or a matching version string will not grant admission.
