import { expect, test } from "bun:test";
import { AgentCardCache } from "./card-cache.js";
import type { A2aEndpoint } from "./config.js";
const card = { name: "Fixture", supportedInterfaces: [], skills: [] };
const endpoint = (): A2aEndpoint => ({
  alias: "fixture",
  cardUrl: "https://fixture.invalid/card",
  allowPrivate: false,
  enabled: true,
  credentialKey: "token",
  cardCacheMaxAgeSeconds: 60,
});

test("explicit bounded cache uses ETag revalidation, isolates work and credential rotations", async () => {
  const cache = new AgentCardCache(),
    ep = endpoint();
  let secret = "one",
    calls = 0;
  const seen: (string | null)[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const tag = new Headers(init?.headers).get("if-none-match");
    seen.push(tag);
    return tag
      ? new Response(null, {
          status: 304,
          headers: { ETag: '"one"', "Cache-Control": "private, max-age=60" },
        })
      : Response.json(card, {
          headers: { ETag: '"one"', "Cache-Control": "private, max-age=60" },
        });
  }) as unknown as typeof fetch;
  const resolve = async () => secret;
  expect(
    await cache.get(ep, "work-a", fetcher, resolve, undefined, 1000),
  ).toEqual(card);
  (await cache.get(ep, "work-a", fetcher, resolve, undefined, 2000)).name =
    "mutated copy";
  expect(calls).toBe(1);
  expect(
    (await cache.get(ep, "work-a", fetcher, resolve, undefined, 62000)).name,
  ).toBe("Fixture");
  expect(seen).toEqual([null, '"one"']);
  await cache.get(ep, "work-b", fetcher, resolve, undefined, 63000);
  expect(calls).toBe(3);
  secret = "two";
  await cache.get(ep, "work-a", fetcher, resolve, undefined, 64000);
  expect(calls).toBe(4);
});

test("no-store, disabled caching, errors, unsolicited 304 and stale fallback are safe", async () => {
  let calls = 0;
  const cache = new AgentCardCache(),
    ep = endpoint(),
    resolve = async () => "token";
  const fetcher = (async () => {
    calls++;
    return Response.json(card, {
      headers: { ETag: '"tag"', "Cache-Control": "no-store, max-age=60" },
    });
  }) as unknown as typeof fetch;
  await cache.get(ep, "work", fetcher, resolve);
  await cache.get(ep, "work", fetcher, resolve);
  expect(calls).toBe(2);
  ep.cardCacheMaxAgeSeconds = 0;
  await cache.get(ep, "work", fetcher, resolve);
  expect(calls).toBe(3);
  await expect(
    cache.get(
      ep,
      "work",
      (async () =>
        new Response(null, { status: 304 })) as unknown as typeof fetch,
      resolve,
    ),
  ).rejects.toThrow("Unsolicited");
  ep.cardCacheMaxAgeSeconds = 60;
  await cache.get(
    ep,
    "work",
    (async () =>
      Response.json(card, {
        headers: { "Cache-Control": "max-age=1", ETag: '"old"' },
      })) as unknown as typeof fetch,
    resolve,
    undefined,
    0,
  );
  await expect(
    cache.get(
      ep,
      "work",
      (async () =>
        new Response("failure", { status: 503 })) as unknown as typeof fetch,
      resolve,
      undefined,
      2000,
    ),
  ).rejects.toThrow("503");
  await expect(
    cache.get(
      ep,
      "work",
      (async () =>
        new Response(null, { status: 304 })) as unknown as typeof fetch,
      resolve,
      undefined,
      3000,
    ),
  ).rejects.toThrow("Unsolicited");
});

test("Age and no-cache force validation; body bytes capped before parse", async () => {
  const cache = new AgentCardCache(),
    ep = endpoint(),
    resolve = async () => "token";
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json(card, {
      headers: {
        "Cache-Control": "private,max-age=60",
        Age: "90",
        ETag: '"old"',
      },
    });
  }) as unknown as typeof fetch;
  await cache.get(ep, "work", fetcher, resolve, undefined, 0);
  await cache.get(ep, "work", fetcher, resolve, undefined, 1);
  expect(calls).toBe(2);
  await expect(
    cache.get(
      ep,
      "other",
      (async () =>
        new Response("x".repeat(128 * 1024 + 1))) as unknown as typeof fetch,
      resolve,
    ),
  ).rejects.toThrow("size limit");
});

test("cached signed cards recheck key expiry and rotated local key bytes on every hit", async () => {
  const { generateKeyPair, exportJWK } = await import("jose");
  const { signCard } = await import("./card-security.js");
  const pair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  let publicJson = JSON.stringify(await exportJWK(pair.publicKey));
  const privateJson = JSON.stringify(await exportJWK(pair.privateKey));
  const resolve = async (name: string) =>
    name === "private"
      ? privateJson
      : name === "public"
        ? publicJson
        : "bearer";
  const policy = {
    keys: [
      {
        kid: "k",
        publicKeyRef: "public",
        notBefore: new Date(0).toISOString(),
        expiresAt: new Date(5000).toISOString(),
      },
    ],
  };
  const signed = await signCard(
    {
      ...card,
      description: "test",
      version: "1",
      capabilities: {},
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
    },
    { kid: "k", privateKeyRef: "private" },
    resolve,
  );
  const ep = { ...endpoint(), cardVerification: policy };
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json(signed, {
      headers: { "Cache-Control": "max-age=60", ETag: '"signed"' },
    });
  }) as unknown as typeof fetch;
  const cache = new AgentCardCache();
  await cache.get(ep, "work", fetcher, resolve, undefined, 1000);
  await cache.get(ep, "work", fetcher, resolve, undefined, 2000);
  expect(calls).toBe(1);
  await expect(
    cache.get(ep, "work", fetcher, resolve, undefined, 6000),
  ).rejects.toThrow("No trusted");
  publicJson = JSON.stringify(
    await exportJWK(
      (await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true }))
        .publicKey,
    ),
  );
  await expect(
    cache.get(ep, "work", fetcher, resolve, undefined, 3000),
  ).rejects.toThrow("No trusted");
  expect(calls).toBe(3);
});

test("fresh cache trust failure refetches new signed bytes unconditionally after key rotation", async () => {
  const { generateKeyPair, exportJWK } = await import("jose");
  const { signCard } = await import("./card-security.js");
  const make = async () => {
    const pair = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    return {
      public: JSON.stringify(await exportJWK(pair.publicKey)),
      private: JSON.stringify(await exportJWK(pair.privateKey)),
    };
  };
  let current = await make();
  const secrets = async (name: string) =>
    name === "public"
      ? current.public
      : name === "private"
        ? current.private
        : "bearer";
  const raw = {
    name: "signed",
    description: "",
    version: "1",
    capabilities: {},
    skills: [],
    supportedInterfaces: [],
    defaultInputModes: [],
    defaultOutputModes: [],
  };
  let signed = await signCard(
    raw,
    { kid: "k", privateKeyRef: "private" },
    secrets,
  );
  let calls = 0;
  const tags: (string | null)[] = [];
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    tags.push(new Headers(init?.headers).get("if-none-match"));
    return Response.json(signed, {
      headers: { ETag: '"v' + calls + '"', "Cache-Control": "max-age=60" },
    });
  }) as unknown as typeof fetch;
  const cache = new AgentCardCache(),
    ep = {
      ...endpoint(),
      cardVerification: {
        keys: [
          {
            kid: "k",
            publicKeyRef: "public",
            notBefore: "2020-01-01",
            expiresAt: "2099-01-01",
          },
        ],
      },
    };
  await cache.get(ep, "work", fetcher, secrets);
  current = await make();
  signed = await signCard(
    { ...raw, name: "rotated" },
    { kid: "k", privateKeyRef: "private" },
    secrets,
  );
  expect((await cache.get(ep, "work", fetcher, secrets)).name).toBe("rotated");
  expect(calls).toBe(2);
  expect(tags).toEqual([null, null]);
});
