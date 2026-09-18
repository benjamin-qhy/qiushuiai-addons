# Card discovery validation — 18 September 2026

Candidate for optional issue #128; not deployed or enabled on production. All networking below is disposable loopback traffic. No production keys, credentials or VM were used.

| Gate | Result |
|---|---|
| All compatibility typechecks | Passed |
| Full A2A suite with companion core, browser and both Python checks enabled | 62 passed, 488 assertions across 15 files |
| Repository compatibility tests | 192 passed, 7 opt-in skips; skipped checks passed in full run above |
| Standalone A2A import with its own dependency install | Passed |
| Offline protobuf field-map regeneration check | Passed: 21 reachable message definitions |
| Changed-file lint, catalog, whitespace and package dry run | Passed; 45 packaged files, about 0.84 MB |

The initial combined run exceeded the existing browser startup hook's five-second default. Its isolated run passed; the complete suite then passed with `bun test --timeout 15000 addons/a2a`, including all four existing settings/browser cases. No assertion was weakened.

## Independent signing evidence

`protocol/verify-card-python.py` uses the separately maintained Python `a2a-sdk==1.1.2` protobuf descriptors, `rfc8785==0.1.4` and Python cryptography to reconstruct and verify the exact Ed25519 JWS input emitted by the add-on. The fixture includes empty required strings/arrays, present optional defaults and opaque Struct contents. Keys are generated per test and passed by stdin only; there is no key-fetch endpoint.

The normative v1.0.1 snapshot retains required empty fields. The pinned JS SDK canonicalizer drops some of them. `card-security.test.ts` explicitly characterises that difference; the add-on uses generated field-presence rules and fails closed on unknown signed schema fields. It does not silently accept a second canonical form.

## Security and integration cases

- Tampering, missing signatures, rotated/expired/revoked keys, private keys supplied as public refs, algorithm confusion, unprotected authority, critical headers, embedded JWKs and key URL headers.
- Duplicate/escaped duplicate JSON keys, excessive nesting, invalid Unicode and nonfinite JSON values.
- Credential/work/endpoint cache isolation, credential rotation, key validity on every fresh hit, no-store/no-cache/Age, bounded TTL, unsolicited/changed 304, HTTP failure and no stale fallback.
- Actual pinned HTTP transport accepts conditional 304 without following redirects.
- Authenticated signed server card, private ETag/Vary handling, conditional requests after target/principal revocation, and card change invalidation.
- Fixed well-known proxy alias: only one target, bearer forwarded, suffix paths rejected, disabled target still denied. No runtime root route is registered.
- Actual client verifies an emitted signed card and revalidates through HTTP, preserving signed field presence in discovery output.

## Boundaries

Caching defaults off. Server signing and required client verification are separate explicit settings. Ed25519 with local keychain references is the only signature profile implemented; remote JWK URLs and extended/public redacted cards remain unsupported/unadvertised. The proxy configuration is a tested pattern for an operator-managed reverse proxy, not an automatically installed server change. Signatures do not replace authentication, principal/target grants, DNS pinning or current-work budget admission.

Issue #129 push callbacks remain disabled until their separate durable-outbox, receiver-authentication and SSRF/replay acceptance work is complete. The initial A2A epic stays closed; neither follow-up is declared merged by this receipt.

## Independent merge review

A separate judge review identified (1) a fresh cached card remaining stuck after trust-key rotation and (2) default reconstruction permitting remote required-field omission. Fixed by evicting cached bytes/ETag and refetching once on trust failure, and rejecting missing/null remote required fields. A follow-up tightened local signing to reconstruct omitted SDK defaults only, never explicit null. Regression tests cover rotation refetch, missing/null/nested required values and local omitted-vs-null signing. Final judge confirmed the blockers resolved; the complete 62-test gate passed. No production enablement.
