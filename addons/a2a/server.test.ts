import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientFactory } from "@a2a-js/sdk/client";
import { SendMessageRequest, Task, TaskState } from "@a2a-js/sdk";
import { createA2aServer } from "./server.js";
import { A2aTaskStore, type PublicOperation } from "./task-store.js";
import type { A2aConfig } from "./config.js";
import type { OperationAdapter } from "./runtime-api.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const token = "disposable-a2a-client-token-long-enough";
function fixture(
  secret: (name: string) => Promise<string | null> = async () => token,
) {
  const dir = mkdtempSync(join(tmpdir(), "a2a-server-"));
  dirs.push(dir);
  const config: A2aConfig = {
    enabled: true,
    inbound: true,
    outbound: false,
    publicBaseUrl: "https://example.invalid",
    principals: [
      {
        id: "alice",
        credentialKey: "fixture/key",
        enabled: true,
        targets: ["echo"],
      },
    ],
    agents: [
      { id: "echo", name: "Echo", description: "fixture", enabled: true },
    ],
    endpoints: [],
  };
  const ops = new Map<string, PublicOperation>();
  const keys = new Map<string, string>();
  let calls = 0;
  const adapter: OperationAdapter = {
    forPrincipal() {
      return {
        version: 1,
        async admit(input) {
          let id = keys.get(input.idempotencyKey);
          const created = !id;
          if (!id) {
            id = crypto.randomUUID();
            keys.set(input.idempotencyKey, id);
            calls++;
            ops.set(id, {
              id,
              sequence: 2,
              status: "working",
              output: null,
              reason: null,
              updatedAt: new Date().toISOString(),
            });
          }
          return {
            created,
            admission: "allow",
            operation: { ...ops.get(id)! },
          };
        },
        async get(id) {
          const op = ops.get(id);
          if (!op) throw new Error("Unavailable");
          return { ...op };
        },
        async cancel(id) {
          const op = ops.get(id)!;
          Object.assign(op, { status: "cancelled", sequence: op.sequence + 1 });
          return { outcome: "cancelled", operation: { ...op } };
        },
        async resume(id) {
          return { resumed: false, operation: ops.get(id)! };
        },
        async continue(id) {
          return { resumed: false, operation: ops.get(id)! };
        },
      };
    },
  };
  const store = new A2aTaskStore(dir);
  const server = createA2aServer(() => config, store, adapter, secret);
  const request = (
    path = "rpc",
    body?: unknown,
    auth = true,
    signal?: AbortSignal,
  ) =>
    new Request("https://example.invalid/api/addons/a2a/agents/echo/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "a2a-version": "1.0",
        ...(auth ? { authorization: "Bearer " + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  const send = (id: string, stream = false) => ({
    jsonrpc: "2.0",
    id,
    method: stream ? "SendStreamingMessage" : "SendMessage",
    params: {
      message: { messageId: id, role: "ROLE_USER", parts: [{ text: "input" }] },
      configuration: { returnImmediately: true },
    },
  });
  return { server, store, config, ops, request, send, calls: () => calls };
}

test("HTTP auth and target privacy run before cards, operations or executor work", async () => {
  const f = fixture();
  try {
    expect(
      (await f.server.handle(f.request("agent-card.json", undefined, false)))
        .status,
    ).toBe(401);
    expect(
      (await f.server.handle(f.request("rpc", f.send("no-auth"), false)))
        .status,
    ).toBe(401);
    expect(f.calls()).toBe(0);
    const card = await f.server.handle(f.request("agent-card.json"));
    expect(card.status).toBe(200);
    expect(card.headers.get("cache-control")).toContain("private");
    expect(await card.text()).not.toContain(token);
    f.config.principals[0].targets = [];
    expect(
      (await f.server.handle(f.request("rpc", f.send("no-target")))).status,
    ).toBe(404);
    expect(f.calls()).toBe(0);
    f.config.enabled = false;
    expect((await f.server.handle(f.request("agent-card.json"))).status).toBe(
      404,
    );
  } finally {
    f.server.close();
    f.store.close();
  }
});

test("official client interoperates over HTTP, and closing an idle SSE consumer releases concurrency without cancelling work", async () => {
  const f = fixture();
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => f.server.handle(req),
  });
  try {
    const authFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = new URL(
        input instanceof Request ? input.url : String(input),
      );
      const url = new URL(requested.pathname, listener.url);
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer " + token);
      return fetch(url, { ...init, headers });
    }) as typeof fetch;
    // SDK transport factories carry the authentication fetch explicitly.
    const { JsonRpcTransportFactory } = await import("@a2a-js/sdk/client");
    const actual = await new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl: authFetch })],
      cardResolver: {
        resolve: async () =>
          (await import("@a2a-js/sdk")).AgentCard.fromJSON(
            await (await f.server.handle(f.request("agent-card.json"))).json(),
          ),
      },
    }).createFromUrl(listener.url.href);
    const result = (await actual.sendMessage(
      SendMessageRequest.fromJSON(f.send("sdk").params),
    )) as Task;
    expect(result.status?.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(f.calls()).toBe(1);
    const controller = new AbortController();
    const response = await f.server.handle(
      f.request("rpc", f.send("stream", true), true, controller.signal),
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"task"',
    );
    expect(f.server.activeRequests()).toBe(1);
    await reader.cancel();
    expect(f.server.activeRequests()).toBe(0);
    expect([...f.ops.values()].every((op) => op.status === "working")).toBe(
      true,
    );
    const op = [...f.ops.values()][1];
    Object.assign(op, {
      status: "completed",
      output: "persisted result",
      sequence: 3,
    });
    expect(f.calls()).toBe(2);
  } finally {
    f.server.close();
    listener.stop(true);
    f.store.close();
  }
}, 10000);

test("server shutdown drains an idle unread SSE response without cancelling durable work", async () => {
  const f = fixture();
  try {
    const response = await f.server.handle(
      f.request("rpc", f.send("idle", true)),
    );
    expect(f.server.activeRequests()).toBe(1);
    f.server.close();
    await f.server.drained();
    expect(f.server.activeRequests()).toBe(0);
    await response.body?.cancel();
    expect([...f.ops.values()].every((op) => op.status === "working")).toBe(
      true,
    );
  } finally {
    f.server.close();
    f.store.close();
  }
});

test("shutdown cancels a stalled request body before parser or executor can run", async () => {
  const f = fixture();
  let cancelled = false;
  try {
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request(
      "https://example.invalid/api/addons/a2a/agents/echo/rpc",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          "a2a-version": "1.0",
        },
        body,
      },
    );
    const response = f.server.handle(req);
    await Bun.sleep(1);
    f.server.close();
    await response;
    await f.server.drained();
    expect(cancelled).toBe(true);
    expect(f.calls()).toBe(0);
    expect(f.server.activeRequests()).toBe(0);
  } finally {
    f.server.close();
    f.store.close();
  }
});

test("inbound request quota is principal-bound and overflow never reaches execution", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 120; i++)
      expect((await f.server.handle(f.request("agent-card.json"))).status).toBe(
        200,
      );
    expect(
      (await f.server.handle(f.request("rpc", f.send("over-quota")))).status,
    ).toBe(429);
    expect(f.calls()).toBe(0);
  } finally {
    f.server.close();
    await f.server.drained();
    f.store.close();
  }
});

test("slow credential providers are concurrency bounded before authentication and release request waits on abort", async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((r) => {
    resolve = r;
  });
  let lookups = 0;
  const f = fixture(async () => {
    lookups++;
    return pending;
  });
  const controllers = Array.from({ length: 16 }, () => new AbortController());
  const responses = controllers.map((controller) =>
    f.server.handle(
      f.request("agent-card.json", undefined, true, controller.signal),
    ),
  );
  try {
    await Bun.sleep(0);
    expect(lookups).toBe(16);
    expect((await f.server.handle(f.request("agent-card.json"))).status).toBe(
      429,
    );
    controllers.forEach((controller) => controller.abort());
    expect(
      (await Promise.all(responses)).every(
        (response) => response.status === 503,
      ),
    ).toBe(true);
    expect(f.server.activeRequests()).toBe(0);
    // Uncooperative provider calls still hold their own cap until they settle.
    expect((await f.server.handle(f.request("agent-card.json"))).status).toBe(
      429,
    );
    resolve(token);
    await Bun.sleep(0);
    expect((await f.server.handle(f.request("agent-card.json"))).status).toBe(
      200,
    );
  } finally {
    resolve(token);
    f.server.close();
    await f.server.drained();
    f.store.close();
  }
});

test("authenticated signed Agent Card revalidates privately and revocation prevents conditional disclosure", async () => {
  const { generateKeyPair, exportJWK } = await import("jose");
  const { verifyCard } = await import("./card-security.js");
  const pair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const privateJson = JSON.stringify(await exportJWK(pair.privateKey)),
    publicJson = JSON.stringify(await exportJWK(pair.publicKey));
  const f = fixture(async (name) => (name === "signing" ? privateJson : token));
  f.config.agents[0].cardSigning = { kid: "server", privateKeyRef: "signing" };
  try {
    const first = await f.server.handle(f.request("agent-card.json"));
    const etag = first.headers.get("etag")!;
    const card = await first.json();
    expect(first.headers.get("vary")).toBe("Authorization");
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    await verifyCard(
      card,
      {
        keys: [
          {
            kid: "server",
            publicKeyRef: "public",
            notBefore: "2020-01-01",
            expiresAt: "2099-01-01",
          },
        ],
      },
      async () => publicJson,
    );
    const req = f.request("agent-card.json");
    req.headers.set("If-None-Match", etag);
    expect((await f.server.handle(req)).status).toBe(304);
    const noAuth = f.request("agent-card.json", undefined, false);
    noAuth.headers.set("If-None-Match", etag);
    expect((await f.server.handle(noAuth)).status).toBe(401);
    f.config.agents[0].description = "changed";
    const changed = await f.server.handle(req);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    f.config.principals[0].enabled = false;
    expect((await f.server.handle(req)).status).toBe(401);
  } finally {
    f.server.close();
    await f.server.drained();
    f.store.close();
  }
});

test("fixed well-known proxy alias preserves target and credential gates without adding root runtime routes", async () => {
  const f = fixture();
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path !== "/.well-known/agent-card.json")
        return new Response("no alias", { status: 404 });
      return f.server.handle(
        new Request(
          "https://example.invalid/api/addons/a2a/agents/echo/agent-card.json",
          { method: req.method, headers: req.headers, signal: req.signal },
        ),
      );
    },
  });
  try {
    expect(
      (await fetch(new URL("/.well-known/agent-card.json", proxy.url))).status,
    ).toBe(401);
    const auth = { authorization: "Bearer " + token };
    const card = await fetch(
      new URL("/.well-known/agent-card.json", proxy.url),
      { headers: auth },
    );
    expect(card.status).toBe(200);
    const raw = await card.json();
    expect(raw.supportedInterfaces[0].url).toBe(
      "https://example.invalid/api/addons/a2a/agents/echo/rpc",
    );
    expect(
      (
        await fetch(
          new URL("/.well-known/agent-card.json/private", proxy.url),
          { headers: auth },
        )
      ).status,
    ).toBe(404);
    f.config.enabled = false;
    expect(
      (
        await fetch(new URL("/.well-known/agent-card.json", proxy.url), {
          headers: auth,
        })
      ).status,
    ).toBe(404);
  } finally {
    proxy.stop(true);
    f.server.close();
    await f.server.drained();
    f.store.close();
  }
});
