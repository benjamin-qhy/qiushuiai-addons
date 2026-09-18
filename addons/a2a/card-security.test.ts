import { expect, test } from "bun:test";
import { generateKeyPair, exportJWK, FlattenedSign } from "jose";
import { AgentCard, canonicalizeAgentCard } from "@a2a-js/sdk";
import {
  canonicalAgentCard,
  canonicalJson,
  signCard,
  verifyCard,
  type CardVerification,
} from "./card-security.js";
const unsigned = () => ({
  name: "Fixture",
  description: "fixture card",
  version: "1",
  supportedInterfaces: [
    {
      url: "https://fixture.invalid/rpc",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    },
  ],
  capabilities: { streaming: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
});
async function keys() {
  const pair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const values: Record<string, string> = {
    private: JSON.stringify(await exportJWK(pair.privateKey)),
    public: JSON.stringify(await exportJWK(pair.publicKey)),
  };
  return {
    pair,
    values,
    resolve: async (name: string) => values[name] ?? null,
  };
}
function policy(): CardVerification {
  return {
    keys: [
      {
        kid: "key-1",
        publicKeyRef: "public",
        notBefore: "2026-01-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
      },
    ],
  };
}
const now = Date.parse("2026-09-18T00:00:00Z");

test("canonicalisation retains required empty values and optional scalar presence, omits implicit defaults", () => {
  const raw = {
    ...unsigned(),
    description: "",
    documentationUrl: "",
    iconUrl: "",
    capabilities: { streaming: false, pushNotifications: false },
    skills: [{ id: "s", name: "", description: "", tags: [], examples: [] }],
    provider: { url: "", organization: "" },
  };
  const canonical = JSON.parse(canonicalAgentCard(raw));
  expect(canonical.description).toBe("");
  expect(canonical.skills[0]).toEqual({
    id: "s",
    name: "",
    description: "",
    tags: [],
  });
  expect(canonical.provider).toEqual({ url: "", organization: "" });
  expect(canonical.documentationUrl).toBe("");
  expect(canonical.iconUrl).toBe("");
  expect(canonical.capabilities).toEqual({
    streaming: false,
    pushNotifications: false,
  });
  expect(
    JSON.parse(
      canonicalAgentCard({
        ...unsigned(),
        supportedInterfaces: [
          {
            url: "https://fixture/rpc",
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
            tenant: "",
          },
        ],
      }),
    ).supportedInterfaces[0],
  ).not.toHaveProperty("tenant");
  const sdk = JSON.parse(canonicalizeAgentCard(AgentCard.fromJSON(raw)));
  expect(sdk).not.toHaveProperty("description"); // Pinned SDK difference documented, not silently relied on.
  expect(
    canonicalAgentCard({
      ...unsigned(),
      signatures: [{ signature: "ignored" }],
    }),
  ).toBe(canonicalAgentCard(unsigned()));
  expect(canonicalJson({ b: 1, a: [-0, 1e30, "€"] })).toBe(
    '{"a":[0,1e+30,"€"],"b":1}',
  );
  expect(() => canonicalJson({ bad: NaN })).toThrow();
  expect(() => canonicalJson("\ud800")).toThrow();
  expect(() =>
    canonicalAgentCard({ ...unsigned(), unexpectedSecurityMode: true }),
  ).toThrow("Unknown");
});

test("pinned Ed25519 sign/verify detects tampering, expiry, revocation, and key rotation", async () => {
  const k = await keys(),
    trusted = policy();
  const signed = await signCard(
    unsigned(),
    { kid: "key-1", privateKeyRef: "private" },
    k.resolve,
  );
  await expect(
    verifyCard(signed, trusted, k.resolve, now),
  ).resolves.toBeUndefined();
  await expect(
    verifyCard({ ...signed, name: "tampered" }, trusted, k.resolve, now),
  ).rejects.toThrow("No trusted");
  await expect(verifyCard(unsigned(), trusted, k.resolve, now)).rejects.toThrow(
    "missing",
  );
  await expect(
    verifyCard(signed, { keys: [] }, k.resolve, now),
  ).rejects.toThrow("No trusted");
  await expect(
    verifyCard(signed, trusted, k.resolve, Date.parse("2027-01-01")),
  ).rejects.toThrow("No trusted");
  const replacement = await keys();
  k.values.public = replacement.values.public;
  await expect(verifyCard(signed, trusted, k.resolve, now)).rejects.toThrow(
    "No trusted",
  );
  const rotated = await signCard(
    unsigned(),
    { kid: "key-2", privateKeyRef: "private" },
    replacement.resolve,
  );
  const combined = {
    ...signed,
    signatures: [
      ...(signed.signatures as any[]),
      ...(rotated.signatures as any[]),
    ],
  };
  await expect(
    verifyCard(
      combined,
      { keys: [{ ...trusted.keys[0], kid: "key-2" }] },
      replacement.resolve,
      now,
    ),
  ).resolves.toBeUndefined();
});

test("untrusted JOSE key URLs, embedded keys, algorithm confusion and unprotected authority are rejected without fetching", async () => {
  const k = await keys(),
    payload = new TextEncoder().encode(canonicalAgentCard(unsigned()));
  let resolved = 0;
  const resolver = async (name: string) => {
    resolved++;
    return k.resolve(name);
  };
  for (const headers of [
    { alg: "EdDSA", kid: "key-1", jku: "http://169.254.169.254/keys" },
    { alg: "EdDSA", kid: "key-1", jwk: JSON.parse(k.values.public) },
    { alg: "EdDSA", kid: "key-1", crit: ["custom"], custom: true },
  ]) {
    let signed;
    if ("crit" in headers) {
      signed = {
        protected: Buffer.from(JSON.stringify(headers)).toString("base64url"),
        signature: "a",
      };
    } else {
      const s = await new FlattenedSign(payload)
        .setProtectedHeader(headers)
        .sign(k.pair.privateKey);
      signed = { protected: s.protected, signature: s.signature };
    }
    await expect(
      verifyCard(
        { ...unsigned(), signatures: [signed] },
        policy(),
        resolver,
        now,
      ),
    ).rejects.toThrow();
  }
  expect(resolved).toBe(0);
  const signed = await signCard(
    unsigned(),
    { kid: "key-1", privateKeyRef: "private" },
    k.resolve,
  );
  const sig = (signed.signatures as any[])[0];
  sig.header = { kid: "other" };
  await expect(verifyCard(signed, policy(), k.resolve, now)).rejects.toThrow();
  k.values.public = k.values.private;
  await expect(verifyCard(signed, policy(), k.resolve, now)).rejects.toThrow();
});

(process.env.PICLAW_A2A_PYTHON ? test : test.skip)(
  "independent Python protobuf descriptors/RFC8785/cryptography verify the emitted JWS bytes",
  async () => {
    const k = await keys();
    const card = await signCard(
      {
        ...unsigned(),
        description: "",
        iconUrl: "",
        provider: { organization: "", url: "" },
        skills: [{ id: "s", name: "", description: "", tags: [] }],
        capabilities: {
          streaming: false,
          extensions: [
            {
              uri: "urn:test",
              params: { zero: 0, empty: "", false: false, arr: [] },
            },
          ],
        },
      },
      { kid: "key-1", privateKeyRef: "private" },
      k.resolve,
    );
    const proc = Bun.spawn(
      [
        process.env.PICLAW_A2A_PYTHON!,
        new URL("./protocol/verify-card-python.py", import.meta.url).pathname,
      ],
      {
        stdin: new Blob([
          JSON.stringify({
            card,
            canonical: canonicalAgentCard(card),
            key: JSON.parse(k.values.public),
          }),
        ]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code, err).toBe(0);
    expect(out).toContain("INDEPENDENT-PROTOBUF-JCS-ED25519-PASS");
  },
);

test("JSON canonical input rejects duplicate escaped keys and excessive nesting before lossy parse", async () => {
  const { parseCardJson } = await import("./card-json.js");
  expect(parseCardJson('{"a":[1,true,null,{"x":"quoted\\\"text"}]}')).toEqual({
    a: [1, true, null, { x: 'quoted"text' }],
  });
  for (const value of [
    '{"name":"a","name":"b"}',
    '{"a":{"x":1,"\\u0078":2}}',
    '{"a":1,}',
    '{"a":NaN}',
    "[".repeat(42) + "0" + "]".repeat(42),
  ])
    expect(() => parseCardJson(value)).toThrow();
});
