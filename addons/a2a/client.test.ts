import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2aClientStore } from "./client-store.js";
import { A2aOutboundClient } from "./client.js";
import type { A2aConfig } from "./config.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Hand-written A2A v1 wire peer: deliberately does not import our handler or SDK server.
function wirePeer() {
  let sends = 0;
  const requests: any[] = [];
  let broken = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      if (
        req.headers.get("authorization") !==
        "Bearer disposable-remote-key-123456789"
      )
        return new Response("unauthorized", { status: 401 });
      if (new URL(req.url).pathname === "/card")
        return Response.json({
          name: "Independent raw v1 fixture",
          description: "wire",
          version: "1",
          supportedInterfaces: [
            {
              protocolBinding: "JSONRPC",
              protocolVersion: "1.0",
              url: new URL("/rpc", server.url).href,
            },
          ],
          capabilities: { streaming: true },
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: [],
          securitySchemes: {
            bearer: { httpAuthSecurityScheme: { scheme: "bearer" } },
          },
          securityRequirements: [{ schemes: { bearer: { list: [] } } }],
        });
      const call = await req.json();
      requests.push(call);
      expect(req.headers.get("a2a-version")).toBe("1.0");
      const task = {
        id: "raw-task",
        contextId: "raw-context",
        status: { state: "TASK_STATE_WORKING" },
      };
      if (call.method === "SendMessage") {
        sends++;
        if (broken) return new Response("lost outcome", { status: 500 });
        expect(call.params.message.role).toBe("ROLE_USER");
        expect(call.params.configuration.returnImmediately).toBe(true);
        return Response.json({ jsonrpc: "2.0", id: call.id, result: { task } });
      }
      if (call.method === "GetTask")
        return Response.json({
          jsonrpc: "2.0",
          id: call.id,
          result: {
            ...task,
            status: { state: "TASK_STATE_COMPLETED" },
            artifacts: [
              { artifactId: "result", parts: [{ text: "independent output" }] },
            ],
          },
        });
      if (call.method === "CancelTask")
        return Response.json({
          jsonrpc: "2.0",
          id: call.id,
          result: { ...task, status: { state: "TASK_STATE_CANCELED" } },
        });
      if (call.method === "SubscribeToTask")
        return new Response(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: call.id, result: { task } })}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: call.id, result: { statusUpdate: { taskId: task.id, contextId: task.contextId, status: { state: "TASK_STATE_COMPLETED" } } } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      return Response.json({
        jsonrpc: "2.0",
        id: call.id,
        error: { code: -32601, message: "Method not found" },
      });
    },
  });
  return {
    server,
    requests,
    sends: () => sends,
    break: () => {
      broken = true;
    },
  };
}
function clientFixture(url: string) {
  const dir = mkdtempSync(join(tmpdir(), "a2a-client-"));
  dirs.push(dir);
  const store = new A2aClientStore(dir);
  const config: A2aConfig = {
    enabled: true,
    inbound: false,
    outbound: true,
    publicBaseUrl: "",
    agents: [],
    principals: [],
    endpoints: [
      {
        alias: "raw",
        enabled: true,
        allowPrivate: true,
        cardUrl: url,
        credentialKey: "fixture/remote",
      },
    ],
  };
  const client = new A2aOutboundClient(
    () => config,
    store,
    async () => "disposable-remote-key-123456789",
  );
  return { client, store, config, dir };
}

test("outbound client discovers explicit card and performs v1 send/query/cancel/subscribe against independent wire peer", async () => {
  const remote = wirePeer(),
    f = clientFixture(new URL("/card", remote.server.url).href),
    call = { scope: "work-a", endpoint: "raw" };
  try {
    const card = (await f.client.discover(call)) as any;
    expect(card.name).toContain("Independent");
    const sent = (await f.client.send(call, {
      messageId: "one",
      text: "request",
    })) as any;
    expect(sent.task.id).toBe("raw-task");
    expect(remote.sends()).toBe(1);
    expect(
      await f.client.send(call, { messageId: "one", text: "request" }),
    ).toEqual(sent);
    expect(remote.sends()).toBe(1);
    await expect(
      f.client.send(call, { messageId: "one", text: "conflict" }),
    ).rejects.toThrow("conflicts");
    const result = (await f.client.get(call, "raw-task")) as any;
    expect(result.status.state).toBe("TASK_STATE_COMPLETED");
    expect(
      ((await f.client.cancel(call, "raw-task")) as any).status.state,
    ).toBe("TASK_STATE_CANCELED");
    const events = [];
    for await (const event of f.client.subscribe(call, "raw-task"))
      events.push(event);
    expect(events).toHaveLength(2);
    await expect(
      f.client.get({ scope: "work-b", endpoint: "raw" }, "raw-task"),
    ).rejects.toThrow("calling scope");
    f.config.endpoints[0].enabled = false;
    await expect(f.client.get(call, "raw-task")).rejects.toThrow("disabled");
  } finally {
    f.store.close();
    remote.server.stop(true);
  }
});

test("ambiguous outbound send survives store reopen as unknown and is never automatically resubmitted", async () => {
  const remote = wirePeer(),
    f = clientFixture(new URL("/card", remote.server.url).href),
    call = { scope: "work-a", endpoint: "raw" };
  try {
    remote.break();
    await expect(
      f.client.send(call, { messageId: "unknown", text: "request" }),
    ).rejects.toThrow("outcome may be unknown");
    expect(remote.sends()).toBe(1);
    f.store.close();
    const reopened = new A2aClientStore(f.dir);
    try {
      const client = new A2aOutboundClient(
        () => f.config,
        reopened,
        async () => "disposable-remote-key-123456789",
      );
      await expect(
        client.send(call, { messageId: "unknown", text: "request" }),
      ).rejects.toThrow("unknown");
      expect(remote.sends()).toBe(1);
    } finally {
      reopened.close();
    }
  } finally {
    remote.server.stop(true);
  }
});

test("changing an endpoint URL does not transfer old task ownership to the replacement server", async () => {
  const first = wirePeer(),
    second = wirePeer(),
    f = clientFixture(new URL("/card", first.server.url).href),
    call = { scope: "work-a", endpoint: "raw" };
  try {
    await f.client.send(call, { messageId: "bound", text: "request" });
    f.config.endpoints[0].cardUrl = new URL("/card", second.server.url).href;
    await expect(f.client.get(call, "raw-task")).rejects.toThrow(
      "calling scope",
    );
    expect(second.requests).toHaveLength(0);
  } finally {
    await f.client.shutdown();
    f.store.close();
    first.server.stop(true);
    second.server.stop(true);
  }
});
