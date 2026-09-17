import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentCard,
  SendMessageRequest,
  GetTaskRequest,
  ListTasksRequest,
  CancelTaskRequest,
  SubscribeToTaskRequest,
  TaskState,
} from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { A2aRequestHandler, REQUEST_SIGNAL } from "./handler.js";
import { A2aTaskStore, type PublicOperation } from "./task-store.js";
import type { OperationAdapter, OperationClient } from "./runtime-api.js";
import type { A2aConfig } from "./config.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "a2a-handler-"));
  dirs.push(dir);
  const store = new A2aTaskStore(dir),
    data = new Map<
      string,
      {
        principal: string;
        operation: PublicOperation;
        key: string;
        text: string;
      }
    >();
  let calls = 0;
  const config: A2aConfig = {
    enabled: true,
    inbound: true,
    outbound: false,
    publicBaseUrl: "https://fixture.invalid",
    agents: [{ id: "echo", name: "Echo", description: "test", enabled: true }],
    principals: ["alice", "bob"].map((id) => ({
      id,
      enabled: true,
      credentialKey: "secret/" + id,
      targets: ["echo"],
    })),
    endpoints: [],
  };
  const adapter: OperationAdapter = {
    forPrincipal(principal) {
      const get = (id: string) => {
        const r = data.get(id);
        if (!r || r.principal !== principal) throw new Error("unavailable");
        return r.operation;
      };
      const client: OperationClient = {
        version: 1,
        async admit(input) {
          const prior = [...data.values()].find(
            (r) => r.principal === principal && r.key === input.idempotencyKey,
          );
          if (prior)
            return {
              created: false,
              admission: "allow",
              operation: prior.operation,
            };
          calls++;
          const id = crypto.randomUUID();
          const operation: PublicOperation = {
            id,
            status: "working",
            sequence: 2,
            output: null,
            reason: null,
            updatedAt: new Date().toISOString(),
          };
          data.set(id, {
            principal,
            operation,
            key: input.idempotencyKey,
            text: input.text,
          });
          return { created: true, admission: "allow", operation };
        },
        async get(id) {
          return { ...get(id) };
        },
        async cancel(id) {
          const op = get(id);
          op.status = "cancelled";
          op.sequence++;
          return { outcome: "cancelled", operation: op };
        },
        async continue(id, text) {
          const op = get(id);
          op.status = "completed";
          op.sequence++;
          op.output = text;
          return { resumed: true, operation: op };
        },
        async resume(id) {
          const op = get(id);
          op.status = "working";
          op.sequence++;
          return { resumed: true, operation: op };
        },
      };
      return client;
    },
  };
  const handler = new A2aRequestHandler("echo", () => config, store, adapter);
  const context = (principal = "alice", signal?: AbortSignal) =>
    new ServerCallContext({
      user: { isAuthenticated: true, userName: principal },
      requestedVersion: "1.0",
      state: new Map(signal ? [[REQUEST_SIGNAL, signal]] : []),
    });
  const send = (id: string, extra: object = {}) =>
    SendMessageRequest.fromJSON({
      message: {
        messageId: id,
        role: "ROLE_USER",
        parts: [{ text: "request" }],
        ...extra,
      },
      configuration: { returnImmediately: true },
    });
  const finish = (id: string, status = "completed", text = "output") => {
    const record = store.get("alice", id);
    const op = data.get(record.operationId!)!.operation;
    Object.assign(op, {
      status,
      output: text,
      sequence: op.sequence + 1,
      updatedAt: new Date().toISOString(),
    });
  };
  return {
    store,
    data,
    config,
    handler,
    context,
    send,
    finish,
    calls: () => calls,
  };
}

test("handler preserves principal ownership, durable send dedup and actual capability card", async () => {
  const f = setup();
  try {
    const card = AgentCard.toJSON(await f.handler.getAgentCard()) as any;
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolVersion: "1.0",
      protocolBinding: "JSONRPC",
    });
    expect(card.securitySchemes.bearer.httpAuthSecurityScheme.scheme).toBe(
      "bearer",
    );
    const first = (await f.handler.sendMessage(
      f.send("m1"),
      f.context(),
    )) as any;
    expect(first.status.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(
      ((await f.handler.sendMessage(f.send("m1"), f.context())) as any).id,
    ).toBe(first.id);
    expect(f.calls()).toBe(1);
    await expect(
      f.handler.getTask(
        GetTaskRequest.fromJSON({ id: first.id }),
        f.context("bob"),
      ),
    ).rejects.toThrow();
    f.finish(first.id);
    const done = await f.handler.getTask(
      GetTaskRequest.fromJSON({ id: first.id, historyLength: 0 }),
      f.context(),
    );
    expect(done.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(done.history).toEqual([]);
    expect(done.artifacts).toHaveLength(1);
    f.config.principals[0].enabled = false;
    await expect(
      f.handler.getTask(GetTaskRequest.fromJSON({ id: first.id }), f.context()),
    ).rejects.toThrow();
  } finally {
    f.store.close();
  }
});

test("blocking send and response streams observe completion without owning persistence", async () => {
  const f = setup();
  try {
    const params = f.send("blocking");
    params.configuration!.returnImmediately = false;
    const pending = f.handler.sendMessage(params, f.context());
    await Bun.sleep(10);
    const record = f.store.list("alice", null, 10)[0];
    f.finish(record.id);
    expect(((await pending) as any).status.state).toBe(
      TaskState.TASK_STATE_COMPLETED,
    );
    const controller = new AbortController();
    const stream = f.handler.sendMessageStream(
      f.send("stream"),
      f.context("alice", controller.signal),
    );
    const initial = await stream.next();
    expect(initial.value?.payload?.$case).toBe("task");
    const task = (initial.value!.payload as any).value;
    const waiting = stream.next();
    controller.abort(new Error("http disconnected"));
    await expect(waiting).rejects.toThrow("http disconnected");
    f.finish(task.id);
    const final = await f.handler.getTask(
      GetTaskRequest.fromJSON({ id: task.id }),
      f.context(),
    );
    expect(final.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const reconnect = f.handler.resubscribe(
      SubscribeToTaskRequest.fromJSON({ id: task.id }),
      f.context(),
    );
    expect((await reconnect.next()).value?.payload?.$case).toBe("task");
    expect((await reconnect.next()).done).toBe(true);
  } finally {
    f.store.close();
  }
});

test("continuation is bounded, deduplicated and never applied to a terminal or foreign task", async () => {
  const f = setup();
  try {
    const task = (await f.handler.sendMessage(
      f.send("input"),
      f.context(),
    )) as any;
    f.finish(task.id, "input_required", "value?");
    const next = f.send("answer", {
      taskId: task.id,
      contextId: task.contextId,
      parts: [{ text: "supplied answer" }],
    });
    const result = (await f.handler.sendMessage(next, f.context())) as any;
    expect(result.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(f.calls()).toBe(1);
    await expect(
      f.handler.sendMessage(f.send("late", { taskId: task.id }), f.context()),
    ).rejects.toThrow();
    await expect(
      f.handler.sendMessage(
        f.send("foreign", { taskId: task.id }),
        f.context("bob"),
      ),
    ).rejects.toThrow();
  } finally {
    f.store.close();
  }
});

test("listing is signed, caller/filter bound, history/artifact limited, and cancel is truthful", async () => {
  const f = setup();
  try {
    for (let i = 0; i < 3; i++)
      await f.handler.sendMessage(f.send("page" + i), f.context());
    const params = ListTasksRequest.fromJSON({ pageSize: 2, historyLength: 0 });
    const page = await f.handler.listTasks(params, f.context());
    expect(page.tasks).toHaveLength(2);
    expect(page.nextPageToken).not.toBe("");
    expect(
      page.tasks.every((t) => !t.artifacts.length && !t.history.length),
    ).toBe(true);
    const next = await f.handler.listTasks(
      { ...params, pageToken: page.nextPageToken },
      f.context(),
    );
    expect(next.tasks).toHaveLength(1);
    expect(next.nextPageToken).toBe("");
    await expect(
      f.handler.listTasks(
        { ...params, pageToken: page.nextPageToken + "x" },
        f.context(),
      ),
    ).rejects.toThrow("page token");
    await expect(
      f.handler.listTasks(
        { ...params, pageToken: page.nextPageToken },
        f.context("bob"),
      ),
    ).rejects.toThrow("page token");
    const cancelled = await f.handler.cancelTask(
      CancelTaskRequest.fromJSON({ id: page.tasks[0].id }),
      f.context(),
    );
    expect(cancelled.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
  } finally {
    f.store.close();
  }
});
