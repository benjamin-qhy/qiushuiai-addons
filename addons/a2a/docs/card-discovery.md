# Agent Card discovery, caching and local trust

Card caching and signatures are optional. Existing 0.2.x configurations remain valid: no cache and no signature requirement unless explicitly configured. The A2A service still requires operator enablement, bearer authentication, published target grants and separate core operation grants. A verified signature grants no authority to execute.

## Exact well-known alias

The add-on cannot and does not register arbitrary core root paths. An operator may expose one explicitly selected existing card through the standard discovery path on a dedicated HTTPS virtual host:

```nginx
location = /.well-known/agent-card.json {
    proxy_pass http://127.0.0.1:8080/api/addons/a2a/agents/summarise/agent-card.json;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
    proxy_cache off;
}
```

Use an **exact** location and fixed target; do not rewrite a caller-controlled path or expose arbitrary agents. The HTTPS public origin and card interface URL remain operator configuration. The alias forwards authentication; no credential is embedded in the proxy config and no public unauthenticated card is introduced. A disabled/revoked target still returns 404/401, including conditional requests. This proxy example is operator-run deployment configuration, not installed by the add-on.

An outbound endpoint can set `cardUrl` to `https://agents.example/.well-known/agent-card.json` or any explicit same-origin card URL. Approved-origin/DNS/address-pinning checks remain unchanged. Discovery does not scan the network.

## Cache and HTTP revalidation

Endpoints optionally accept `cardCacheMaxAgeSeconds` from 0 through 300; omitted/0 disables caching. Cache entries are in-memory and scoped to calling work, complete endpoint policy and a hash including the currently resolved bearer credential. No credential or card is persisted by the cache.

- Respect `no-store`, `no-cache`, bounded `max-age` and `Age`; missing/malformed cache lifetime means revalidate, not an implicit TTL.
- Send `If-None-Match` only for a previously fetched ETag. Reject unsolicited 304 or an ETag change in a 304.
- Never serve a stale card after network, validation or trust failure. Cache eviction is bounded to 64 entries; shutdown clears all entries.
- Every cache hit rechecks configured key validity and resolves the current pinned key bytes. Removing/rotating a key or credential cannot hide behind a fresh cache entry.
- Endpoint and current-work admission are rechecked even when a card is cached. Card-derived interface URLs retain the same-origin restriction.

Inbound cards use `Cache-Control: private, no-cache`, a principal-bound strong `ETag`, and `Vary: Authorization`. They authenticate and authorise before responding 304. A changed card/key yields a changed ETag. No shared/proxy cache is enabled, and the advertised extended-card capability remains false.

## Optional Ed25519 signatures

A published agent can select a private JWK held in Keychain:

```json
{
  "id": "summarise",
  "name": "Summarise",
  "description": "Public text work",
  "enabled": true,
  "cardSigning": { "kid": "signing-2026", "privateKeyRef": "a2a/card-signing" }
}
```

The selected key must be an Ed25519 OKP JWK. Only its reference is stored in settings. The emitted JWS is detached flattened JSON (`protected`, `signature`), with protected `alg: EdDSA`, `kid`, and `typ: JOSE`. Signing fails closed if a selected key is missing or invalid; private-key bytes never enter a card or HTTP error.

An outbound endpoint can require a signature from pinned public-key references:

```json
{
  "alias": "lab",
  "cardUrl": "https://agents.example/.well-known/agent-card.json",
  "credentialKey": "a2a/lab-bearer",
  "allowPrivate": false,
  "enabled": true,
  "cardCacheMaxAgeSeconds": 60,
  "cardVerification": {
    "keys": [{
      "kid": "signing-2026",
      "publicKeyRef": "a2a/lab-public-jwk",
      "notBefore": "2026-01-01T00:00:00Z",
      "expiresAt": "2027-01-01T00:00:00Z"
    }]
  }
}
```

The presence of `cardVerification` makes verification mandatory: unsigned, tampered, expired, revoked or untrusted cards fail before use. Pin one to eight public Ed25519 keys. Overlapping validity windows support rotation; remove old keys to revoke. Public references reject private key material. `jku`, `x5u`, embedded JWKs, critical/custom protected headers, other algorithms, and nonempty unprotected JOSE headers are unsupported; no key URL supplied by a card is fetched.

Server signing and client verification are independent opt-ins. Unsigned endpoints remain compatible unless verification is required. Extended/private-card RPCs, public redacted cards and other signing algorithms are not advertised by this slice.

## Canonical bytes

The pinned v1.0.1 protobuf defines required/default/optional-presence rules. `protocol/card-fields.json` is generated offline from the committed, hashed `a2a.proto`; regenerate with `bun addons/a2a/protocol/build-card-fields.ts` and check with `--check`.

Canonicalisation strips the `signatures` field, retains required empty values and explicitly present optional defaults, removes implicit default fields, preserves Struct contents, and uses RFC8785 ordering/number formatting. Lone surrogate strings, nonfinite numbers, unknown signed schema fields and ambiguous oneofs are rejected. This is deliberately stricter than unsigned forward-compatible parsing.

The pinned JS SDK's generic canonicalizer drops some required empty values and should not be used for these signatures. The tests compare our bytes against the separately maintained Python A2A protobuf descriptors and `rfc8785==0.1.4`, then verify Ed25519 using Python cryptography. The generated map follows the pinned schema, not a second handwritten protocol model.

## Checks

```sh
bun run typecheck:a2a
bun test addons/a2a/card-security.test.ts addons/a2a/card-cache.test.ts \
  addons/a2a/card-discovery.test.ts addons/a2a/server.test.ts addons/a2a/security.test.ts
bun addons/a2a/protocol/build-card-fields.ts --check
```

Independent offline signature check (test environment only): install `a2a-sdk==1.1.2` and `rfc8785==0.1.4` in an isolated Python environment, then set `QIUSHUIAI_A2A_PYTHON` to its executable when running `card-security.test.ts`. No production key or peer is required.
