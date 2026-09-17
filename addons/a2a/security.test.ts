import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authenticateA2a,
  authorizeTarget,
  isPublicAddress,
  validateOutboundUrl,
} from "./security.js";
import {
  validateConfig,
  EMPTY_CONFIG,
  A2aConfigStore,
  type A2aConfig,
  type A2aEndpoint,
} from "./config.js";
import { pinnedEndpointFetch } from "./pinned-fetch.js";
const token = "test-only-disposable-credential-123456789";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function config(): A2aConfig {
  return {
    enabled: true,
    inbound: true,
    outbound: true,
    publicBaseUrl: "https://example.invalid",
    principals: [
      {
        id: "client",
        enabled: true,
        credentialKey: "a2a/client",
        targets: ["echo"],
      },
    ],
    endpoints: [],
    agents: [
      { id: "echo", name: "Echo", description: "fixture", enabled: true },
    ],
  };
}

test("disabled defaults and persisted configuration contain only credential references", () => {
  const dir = mkdtempSync(join(tmpdir(), "a2a-config-"));
  dirs.push(dir);
  const store = new A2aConfigStore(dir);
  expect(store.read()).toEqual(EMPTY_CONFIG);
  const cfg = config();
  store.write(cfg);
  expect(store.read()).toEqual(cfg);
  expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(store.read())).not.toContain(token);
  expect(() => validateConfig({ ...cfg, secret: token })).toThrow();
  expect(() =>
    validateConfig({
      ...cfg,
      principals: [...cfg.principals, { ...cfg.principals[0], id: "other" }],
    }),
  ).toThrow("Duplicate");
  expect(() =>
    validateConfig({ ...cfg, publicBaseUrl: "http://insecure.example" }),
  ).toThrow("HTTPS");
  expect(() => validateConfig({ ...cfg, agents: [] })).toThrow();
});

test("bearer authentication, target grants and revocation never trust request ids or cookies", async () => {
  const cfg = config(),
    resolve = async (name: string) => (name === "a2a/client" ? token : null);
  const req = (auth?: string) =>
    new Request("https://fixture/rpc", {
      headers: auth
        ? { authorization: auth }
        : { cookie: "piclaw_session=operator" },
    });
  expect(await authenticateA2a(req(), cfg, resolve)).toBeNull();
  expect(await authenticateA2a(req("Bearer wrong"), cfg, resolve)).toBeNull();
  expect(
    (await authenticateA2a(req("Bearer " + token), cfg, resolve))?.id,
  ).toBe("client");
  expect(authorizeTarget(cfg, "client", "echo")).toBe(true);
  expect(authorizeTarget(cfg, "client", "private")).toBe(false);
  cfg.principals[0].enabled = false;
  expect(
    await authenticateA2a(req("Bearer " + token), cfg, resolve),
  ).toBeNull();
  expect(authorizeTarget(cfg, "client", "echo")).toBe(false);
});

test("all resolved addresses and URL origins are checked before egress", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
  ])
    expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress("8.8.8.8")).toBe(true);
  expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  const endpoint: A2aEndpoint = {
    alias: "peer",
    cardUrl: "https://agent.example/card",
    enabled: true,
    allowPrivate: false,
  };
  await expect(
    validateOutboundUrl(
      endpoint,
      new URL("https://agent.example/rpc"),
      async () => ["8.8.8.8", "127.0.0.1"],
    ),
  ).rejects.toThrow("private");
  await expect(
    validateOutboundUrl(
      endpoint,
      new URL("https://other.example/rpc"),
      async () => ["8.8.8.8"],
    ),
  ).rejects.toThrow("origin");
  await expect(
    validateOutboundUrl(
      endpoint,
      new URL("https://agent.example/rpc"),
      async () => ["8.8.8.8"],
    ),
  ).resolves.toBeUndefined();
});

test("pinned loopback fixture sends only explicit credential and refuses redirect without leaking it", async () => {
  const received: string[] = [];
  const cookies: (string | null)[] = [];
  let secondHits = 0;
  const other = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      secondHits++;
      return new Response("not allowed");
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      received.push(req.headers.get("authorization") || "");
      cookies.push(req.headers.get("cookie"));
      if (new URL(req.url).pathname === "/redirect")
        return new Response(null, {
          status: 302,
          headers: { Location: other.url.href },
        });
      return Response.json({ ok: true });
    },
  });
  try {
    const endpoint: A2aEndpoint = {
      alias: "fixture",
      cardUrl: server.url.href,
      enabled: true,
      allowPrivate: true,
      credentialKey: "fixture/key",
    };
    const transport = pinnedEndpointFetch(endpoint, async () => token);
    const result = await transport(server.url, {
      headers: { cookie: "operator_cookie", authorization: "Bearer arbitrary" },
    });
    expect(await result.json()).toEqual({ ok: true });
    await expect(transport(new URL("/redirect", server.url))).rejects.toThrow(
      "redirect",
    );
    expect(secondHits).toBe(0);
    expect(received).toEqual(["Bearer " + token, "Bearer " + token]);
    expect(cookies).toEqual([null, null]);
    endpoint.allowPrivate = false;
    await expect(transport(server.url)).rejects.toThrow();
  } finally {
    server.stop(true);
    other.stop(true);
  }
});
