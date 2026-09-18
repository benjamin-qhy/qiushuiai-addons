import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Message,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
} from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { A2aTaskStore, type PublicOperation } from "./task-store.js";
import { A2aRequestHandler } from "./handler.js";
import { A2aPushWorker } from "./push-worker.js";
import type { A2aConfig } from "./config.js";
import type { OperationAdapter } from "./runtime-api.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const secret = "disposable-push-credential-123456789";
function fixture(url: string) {
  const dir = mkdtempSync(join(tmpdir(), "a2a-push-"));
  dirs.push(dir);
  const store = new A2aTaskStore(dir);
  const task = store.reserve(
    "alice",
    "echo",
    Message.fromJSON({
      messageId: "initial",
      role: "ROLE_USER",
      parts: [{ text: "work" }],
    }),
  ).record;
  store.attachOperation("alice", task.id, "op");
  const operation: PublicOperation = {
    id: "op",
    status: "working",
    sequence: 2,
    output: null,
    reason: null,
    updatedAt: new Date().toISOString(),
  };
  const events = [{ sequence: 2, snapshot: { ...operation } }];
  const adapter: OperationAdapter = {
    forPrincipal() {
      return {
        version: 1,
        admit: async () => ({ created: false, admission: "allow", operation }),
        get: async () => ({ ...operation }),
        events: async (_id, after = 0) => ({
          snapshot: { ...operation },
          events: events.filter((e) => e.sequence > after),
          gap: false,
        }),
        cancel: async () => ({ outcome: "not_cancellable", operation }),
        continue: async () => ({ resumed: false, operation }),
        resume: async () => ({ resumed: false, operation }),
      };
    },
  };
  const config: A2aConfig = {
    enabled: true,
    inbound: true,
    outbound: false,
    publicBaseUrl: "https://fixture.invalid",
    principals: [
      {
        id: "alice",
        targets: ["echo"],
        credentialKey: "caller",
        enabled: true,
      },
    ],
    agents: [
      { id: "echo", name: "Echo", description: "fixture", enabled: true },
    ],
    endpoints: [],
    push: {
      enabled: true,
      callbacks: [
        {
          id: "approved",
          principal: "alice",
          targets: ["echo"],
          url,
          credentialKey: "callback",
          allowPrivate: true,
          enabled: true,
        },
      ],
      receivers: [],
    },
  };
  const handler = new A2aRequestHandler(
      "echo",
      () => config,
      store,
      adapter,
      async () => secret,
    ),
    context = new ServerCallContext({
      user: { isAuthenticated: true, userName: "alice" },
      requestedVersion: "1.0",
    });
  const create = () =>
    TaskPushNotificationConfig.fromJSON({
      id: "config1",
      taskId: task.id,
      url,
      authentication: { scheme: "bEaReR", credentials: secret },
    });
  return {
    store,
    task,
    config,
    handler,
    context,
    create,
    adapter,
    operation,
    events,
  };
}

test("push config authenticates approved URL/credential and keeps secret bytes out of persisted/read-back config", async () => {
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 204 }),
  });
  const f = fixture(listener.url.href);
  try {
    const cfg = await f.handler.createTaskPushNotificationConfig(
      f.create(),
      f.context,
    );
    expect(cfg.authentication?.scheme).toBe("Bearer");
    expect(cfg.authentication?.credentials).toBe("");
    expect(JSON.stringify(f.store.push.list("alice", f.task.id))).not.toContain(
      secret,
    );
    expect(
      (
        await f.handler.getTaskPushNotificationConfig(
          GetTaskPushNotificationConfigRequest.fromJSON({
            taskId: f.task.id,
            id: "config1",
          }),
          f.context,
        )
      ).id,
    ).toBe("config1");
    const bad = f.create();
    bad.authentication!.credentials = "unapproved";
    await expect(
      f.handler.createTaskPushNotificationConfig(bad, f.context),
    ).rejects.toThrow("credential");
    const url = f.create();
    url.url = "http://169.254.169.254/latest/meta-data/";
    await expect(
      f.handler.createTaskPushNotificationConfig(url, f.context),
    ).rejects.toThrow();
    const other = new ServerCallContext({
      user: { isAuthenticated: true, userName: "bob" },
    });
    await expect(
      f.handler.listTaskPushNotificationConfigs(
        ListTaskPushNotificationConfigsRequest.fromJSON({ taskId: f.task.id }),
        other,
      ),
    ).rejects.toThrow();
    await f.handler.deleteTaskPushNotificationConfig(
      DeleteTaskPushNotificationConfigRequest.fromJSON({
        taskId: f.task.id,
        id: "config1",
      }),
      f.context,
    );
    expect(f.store.push.list("alice", f.task.id)).toEqual([]);
  } finally {
    f.store.close();
    listener.stop(true);
  }
});

test("worker delivers independently of task polling; retries same ID/bytes and observes revocation before network", async () => {
  const received: Array<{
    id: string;
    body: string;
    auth: string | null;
    type: string | null;
  }> = [];
  let fail = true;
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      received.push({
        id: req.headers.get("a2a-delivery-id")!,
        body: await req.text(),
        auth: req.headers.get("authorization"),
        type: req.headers.get("content-type"),
      });
      return new Response(null, { status: fail ? 503 : 204 });
    },
  });
  const f = fixture(listener.url.href);
  let now = Date.now();
  const worker = new A2aPushWorker(
    () => f.config,
    f.store,
    f.adapter,
    async () => secret,
    () => now,
  );
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    now = Date.now() + 10;
    await worker.tick();
    expect(received).toHaveLength(1);
    expect(received[0].auth).toBe("Bearer " + secret);
    expect(received[0].type).toBe("application/a2a+json");
    fail = false;
    now += 60001;
    await worker.tick();
    expect(received[1]).toEqual(received[0]);
    Object.assign(f.operation, {
      status: "completed",
      sequence: 3,
      output: "result",
    });
    f.events.push({ sequence: 3, snapshot: { ...f.operation } });
    await worker.tick();
    expect(f.store.get("alice", f.task.id).task.artifacts).toHaveLength(1);
    expect(
      received.some(
        (r) =>
          JSON.parse(r.body).artifactUpdate?.artifact?.parts?.[0]?.text ===
          "result",
      ),
    ).toBe(true);
    expect(
      received.some(
        (r) =>
          JSON.parse(r.body).statusUpdate?.status?.state ===
          "TASK_STATE_COMPLETED",
      ),
    ).toBe(true);
    f.store.push.enqueue(
      "alice",
      f.task.id,
      "later",
      { task: { id: f.task.id } },
      now,
    );
    const before = received.length;
    f.config.push!.callbacks[0].enabled = false;
    await worker.tick();
    expect(received).toHaveLength(before);
  } finally {
    await worker.close();
    f.store.close();
    listener.stop(true);
  }
});

test("task update and outbox events are atomic, duplicates do not produce duplicate delivery records", async () => {
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 204 }),
  });
  const f = fixture(listener.url.href);
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    f.store.sync("alice", f.task.id, f.operation);
    const before = f.store.push.inspect("alice", f.task.id).length;
    f.store.sync("alice", f.task.id, f.operation);
    expect(f.store.push.inspect("alice", f.task.id)).toHaveLength(before);
    expect(
      f.store.push
        .inspect("alice", f.task.id)
        .some(
          (d) =>
            JSON.parse(d.payload).statusUpdate?.status?.state ===
            "TASK_STATE_WORKING",
        ),
    ).toBe(true);
  } finally {
    f.store.close();
    listener.stop(true);
  }
});

test("multiple callbacks have independent initial events, bounded signed pagination and no duplicate registration deliveries", async () => {
  const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: 204 }),
    }),
    f = fixture(listener.url.href);
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    const second = f.create();
    second.id = "config2";
    await f.handler.createTaskPushNotificationConfig(second, f.context);
    expect(f.store.push.inspect("alice", f.task.id)).toHaveLength(2);
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    expect(f.store.push.inspect("alice", f.task.id)).toHaveLength(2);
    const first = await f.handler.listTaskPushNotificationConfigs(
      ListTaskPushNotificationConfigsRequest.fromJSON({
        taskId: f.task.id,
        pageSize: 1,
      }),
      f.context,
    );
    expect(first.configs).toHaveLength(1);
    expect(first.nextPageToken).not.toBe("");
    const next = await f.handler.listTaskPushNotificationConfigs(
      ListTaskPushNotificationConfigsRequest.fromJSON({
        taskId: f.task.id,
        pageSize: 1,
        pageToken: first.nextPageToken,
      }),
      f.context,
    );
    expect(next.configs).toHaveLength(1);
    expect(next.configs[0].id).not.toBe(first.configs[0].id);
    await expect(
      f.handler.listTaskPushNotificationConfigs(
        ListTaskPushNotificationConfigsRequest.fromJSON({
          taskId: f.task.id,
          pageSize: 2,
          pageToken: first.nextPageToken,
        }),
        f.context,
      ),
    ).rejects.toThrow("pagination");
  } finally {
    f.store.close();
    listener.stop(true);
  }
});

test("worker refuses redirect credential forwarding", async () => {
  let stolen = 0;
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      stolen++;
      return new Response(null, { status: 204 });
    },
  });
  const redirect = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(null, {
          status: 302,
          headers: { Location: sink.url.href },
        }),
    }),
    f = fixture(redirect.url.href);
  const worker = new A2aPushWorker(
    () => f.config,
    f.store,
    f.adapter,
    async () => secret,
  );
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    await worker.tick();
    expect(stolen).toBe(0);
    expect(
      f.store.push
        .inspect("alice", f.task.id)
        .some((d) => d.state === "pending" && d.attempts === 1),
    ).toBe(true);
  } finally {
    await worker.close();
    f.store.close();
    redirect.stop(true);
    sink.stop(true);
  }
});

test("push JSON-RPC validates declared capability and returns standard CRUD wire shapes", async () => {
  const { createSdkHttpHandler } = await import("./sdk-http.js");
  const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: 204 }),
    }),
    f = fixture(listener.url.href);
  const http = createSdkHttpHandler(f.handler);
  const rpc = async (method: string, params: unknown) =>
    (
      await http(
        new Request("https://fixture/rpc", {
          method: "POST",
          headers: { "content-type": "application/json", "a2a-version": "1.0" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
        f.context,
      )
    ).json();
  try {
    expect(
      (await f.handler.getAgentCard()).capabilities?.pushNotifications,
    ).toBe(true);
    const created = await rpc(
      "CreateTaskPushNotificationConfig",
      TaskPushNotificationConfig.toJSON(f.create()),
    );
    expect(created.result.id).toBe("config1");
    expect(JSON.stringify(created)).not.toContain(secret);
    const listed = await rpc("ListTaskPushNotificationConfigs", {
      taskId: f.task.id,
      pageSize: 1,
    });
    expect(listed.result.configs).toHaveLength(1);
    expect(listed.result.nextPageToken ?? "").toBe("");
    expect(
      (
        await rpc("DeleteTaskPushNotificationConfig", {
          taskId: f.task.id,
          id: "config1",
        })
      ).result,
    ).toBeNull();
    f.config.push!.enabled = false;
    expect(
      (
        await rpc(
          "CreateTaskPushNotificationConfig",
          TaskPushNotificationConfig.toJSON(f.create()),
        )
      ).error.code,
    ).toBe(-32003);
  } finally {
    f.store.close();
    listener.stop(true);
  }
});

test("persisted callbacks cannot bypass current operator policy; core denial revokes instead of retrying", async () => {
  let requests = 0;
  const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return new Response(null, { status: 204 });
      },
    }),
    f = fixture(listener.url.href);
  const worker = new A2aPushWorker(
    () => f.config,
    f.store,
    f.adapter,
    async () => secret,
  );
  try {
    f.store.push.upsert({
      principal: "alice",
      taskId: f.task.id,
      id: "bypass",
      url: new URL("/unapproved", listener.url).href,
      credentialKey: "callback",
      allowPrivate: true,
    });
    f.store.push.enqueue("alice", f.task.id, "bypass", {
      task: { id: f.task.id },
    });
    await worker.tick();
    expect(requests).toBe(0);
    expect(f.store.push.list("alice", f.task.id)).toEqual([]);
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    const original = f.adapter.forPrincipal;
    f.adapter.forPrincipal = (principal) => {
      const client = original(principal);
      client.events = async () => {
        const error = new Error("unavailable");
        error.name = "OperationAccessError";
        throw error;
      };
      return client;
    };
    await worker.tick();
    expect(requests).toBe(0);
    expect(f.store.push.list("alice", f.task.id)).toEqual([]);
    expect(
      f.store.push
        .inspect("alice", f.task.id)
        .every((d) => d.state === "revoked"),
    ).toBe(true);
  } finally {
    await worker.close();
    f.store.close();
    listener.stop(true);
  }
});

test("core revocation during credential resolution is rechecked at the final connection boundary", async () => {
  let requests = 0,
    revoked = false;
  const sink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return new Response(null, { status: 204 });
      },
    }),
    f = fixture(sink.url.href);
  const original = f.adapter.forPrincipal;
  f.adapter.forPrincipal = (p) => {
    const c = original(p);
    const get = c.get;
    c.get = async (id) => {
      if (revoked) {
        const e = new Error("denied");
        e.name = "OperationAccessError";
        throw e;
      }
      return get(id);
    };
    return c;
  };
  const worker = new A2aPushWorker(
    () => f.config,
    f.store,
    f.adapter,
    async () => {
      revoked = true;
      return secret;
    },
  );
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    await worker.tick();
    expect(requests).toBe(0);
    expect(f.store.push.list("alice", f.task.id)).toEqual([]);
    expect(
      f.store.push
        .inspect("alice", f.task.id)
        .every((d) => d.state === "revoked"),
    ).toBe(true);
  } finally {
    await worker.close();
    f.store.close();
    sink.stop(true);
  }
});

test("malformed auth object fails with a protocol error instead of a raw TypeError", async () => {
  const { validateWireCallback } = await import("./push-policy.js");
  const sink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: 204 }),
    }),
    f = fixture(sink.url.href);
  try {
    for (const authentication of [
      {},
      { scheme: 3 },
      { scheme: "Bearer", credentials: 4 },
    ])
      await expect(
        validateWireCallback(
          f.config,
          "alice",
          "echo",
          { ...f.create(), authentication } as any,
          async () => secret,
        ),
      ).rejects.toMatchObject({ name: "RequestMalformedError" });
  } finally {
    f.store.close();
    sink.stop(true);
  }
});

test("oversized notification records a delivery failure without reverting a completed task", async () => {
  const sink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: 204 }),
    }),
    f = fixture(sink.url.href);
  try {
    await f.handler.createTaskPushNotificationConfig(f.create(), f.context);
    f.store.sync("alice", f.task.id, {
      ...f.operation,
      status: "completed",
      sequence: 3,
      output: "x".repeat(256 * 1024),
    });
    expect(f.store.get("alice", f.task.id).task.status?.state).toBe(3);
    expect(f.store.push.failures()).toEqual([
      { reason: "payload_limit", count: 2 },
    ]);
  } finally {
    f.store.close();
    sink.stop(true);
  }
});
