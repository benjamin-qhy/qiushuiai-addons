import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  AgentCard,
  Message,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  SendMessageRequest,
  StreamResponse,
} from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  ServerCallContext,
  type AgentExecutor,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";
import { createSdkHttpHandler } from "./sdk-http.js";
import { A2A_PROFILE } from "./profile.js";

// These listeners are ephemeral loopback SDK fixtures. No Piclaw production host,
// model/provider call or installed runtime is used. The host-policy work is A2/C1/C2.
let server: ReturnType<typeof Bun.serve>;
let card: AgentCard;
const inbound: Record<string, unknown>[] = [];
const observedVersions: string[] = [];
let completedExecutions = 0;
let cancelCalls = 0;
const pending = new Map<
  string,
  { contextId: string; bus: ExecutionEventBus }
>();
const executor: AgentExecutor = {
  async execute(context, bus) {
    const text = context.userMessage.parts[0]?.content?.value;
    if (text === "direct") {
      bus.publish(
        AgentEvent.message(
          Message.fromJSON({
            messageId: "reply-" + context.userMessage.messageId,
            contextId: context.contextId,
            role: "ROLE_AGENT",
            parts: [{ text: "SDK direct reply" }],
          }),
        ),
      );
      bus.finished();
      return;
    }
    bus.publish(
      AgentEvent.task(
        Task.fromJSON({
          id: context.taskId,
          contextId: context.contextId,
          status: { state: "TASK_STATE_WORKING" },
        }),
      ),
    );
    if (text === "wait") {
      pending.set(context.taskId, { contextId: context.contextId, bus });
      return;
    }
    await Bun.sleep(10);
    completedExecutions++;
    bus.publish(
      AgentEvent.statusUpdate(
        TaskStatusUpdateEvent.fromJSON({
          taskId: context.taskId,
          contextId: context.contextId,
          status: { state: "TASK_STATE_COMPLETED" },
        }),
      ),
    );
    bus.finished();
  },
  async cancelTask(taskId, bus) {
    cancelCalls++;
    const wait = pending.get(taskId);
    if (!wait) throw new Error("Fixture task not pending");
    bus.publish(
      AgentEvent.statusUpdate(
        TaskStatusUpdateEvent.fromJSON({
          taskId,
          contextId: wait.contextId,
          status: { state: "TASK_STATE_CANCELED" },
        }),
      ),
    );
    bus.finished();
    pending.delete(taskId);
  },
};
const context = () =>
  new ServerCallContext({
    user: { isAuthenticated: true, userName: "fixture-user" },
    tenant: "fixture-only",
    requestedVersion: "1.0",
  });
function request(
  messageId: string,
  text: string,
  configuration?: Record<string, unknown>,
) {
  return {
    jsonrpc: "2.0",
    id: messageId,
    method: "SendMessage",
    params: {
      message: { messageId, role: "ROLE_USER", parts: [{ text }] },
      ...(configuration ? { configuration } : {}),
    },
  };
}
async function post(
  body: unknown,
  version: string | null = "1.0",
  headers: Record<string, string> = {},
) {
  return fetch(new URL(A2A_PROFILE.rpcPath, server.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(version === null ? {} : { "a2a-version": version }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeAll(() => {
  card = AgentCard.fromJSON({
    name: "Disposable SDK fixture",
    description: "No model execution",
    version: "0.1.0",
    supportedInterfaces: [
      {
        url: "http://127.0.0.1:1/api/addons/a2a/rpc",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      { id: "echo", name: "Echo", description: "Fixture only", tags: ["test"] },
    ],
  });
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    executor,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { keepBusAliveStates: [TaskState.TASK_STATE_WORKING] },
  );
  const http = createSdkHttpHandler(handler);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === A2A_PROFILE.cardPath)
        return Response.json(AgentCard.toJSON(card));
      const cloned = req.clone();
      if (req.headers.get("content-type")?.startsWith("application/json")) {
        try {
          inbound.push(await cloned.json());
        } catch {
          /* malformed wire is asserted by the HTTP parser below */ return http(
            req,
            context(),
          );
        }
      }
      observedVersions.push(req.headers.get("a2a-version") || "<missing>");
      return http(req, context());
    },
  });
  card.supportedInterfaces[0].url = new URL(
    A2A_PROFILE.rpcPath,
    server.url,
  ).href;
});
afterAll(() => {
  for (const p of pending.values()) p.bus.finished();
  pending.clear();
  server?.stop(true);
});

test("official SDK client discovers the explicit card and exchanges a direct message on Bun", async () => {
  const client = await new ClientFactory().createFromUrl(
    server.url.href,
    A2A_PROFILE.cardPath,
  );
  const result = await client.sendMessage(
    SendMessageRequest.fromJSON(request("direct-client", "direct").params),
  );
  expect(result).toHaveProperty("messageId", "reply-direct-client");
  expect(Message.toJSON(result as Message)).toMatchObject({
    role: "ROLE_AGENT",
    parts: [{ text: "SDK direct reply" }],
  });
  expect(observedVersions).toContain("1.0");
  const wire = inbound.find((r) => r.id && r.method === "SendMessage")!;
  expect(wire.method).toBe("SendMessage");
  expect(wire.params).toHaveProperty("message.role", "ROLE_USER");
});

test("raw v1 JSON-RPC request returns protobuf JSON, ignoring forward-compatible unknown fields", async () => {
  const payload = request("raw-direct", "direct");
  Object.assign(payload.params.message, { unknownFutureField: { ok: true } });
  const response = await post(payload);
  expect(response.headers.get("content-type")).toContain("application/json");
  const body = await response.json();
  expect(body).toMatchObject({
    jsonrpc: "2.0",
    id: "raw-direct",
    result: { message: { messageId: "reply-raw-direct", role: "ROLE_AGENT" } },
  });
  expect(body.result.message).not.toHaveProperty("kind");
  expect(body.result.message).not.toHaveProperty("taskId");
});

test("default send waits for final state, explicit returnImmediately returns an active task which can be cancelled", async () => {
  const complete = await (await post(request("blocking", "task"))).json();
  expect(complete.result.task.status.state).toBe("TASK_STATE_COMPLETED");
  const early = await (
    await post(request("immediate", "wait", { returnImmediately: true }))
  ).json();
  expect(early.result.task.status.state).toBe("TASK_STATE_WORKING");
  const taskId = early.result.task.id;
  const cancelled = await (
    await post({
      jsonrpc: "2.0",
      id: "cancel",
      method: "CancelTask",
      params: { id: taskId },
    })
  ).json();
  expect(cancelled.result.status.state).toBe("TASK_STATE_CANCELED");
  const get = await (
    await post({
      jsonrpc: "2.0",
      id: "get",
      method: "GetTask",
      params: { id: taskId },
    })
  ).json();
  expect(get.result.status.state).toBe("TASK_STATE_CANCELED");
  expect(pending.has(taskId)).toBe(false);
});

test("official SDK client receives Task then terminal status via response SSE", async () => {
  const client = await new ClientFactory().createFromAgentCard(card);
  const events: StreamResponse[] = [];
  for await (const event of client.sendMessageStream(
    SendMessageRequest.fromJSON(request("stream", "task").params),
  ))
    events.push(event);
  expect(events[0].payload?.$case).toBe("task");
  expect(events.at(-1)?.payload?.$case).toBe("statusUpdate");
  expect(StreamResponse.toJSON(events.at(-1)!)).toHaveProperty(
    "statusUpdate.status.state",
    "TASK_STATE_COMPLETED",
  );
  expect(inbound.some((r) => r.method === "SendStreamingMessage")).toBe(true);
});

test("version, envelope, role, legacy parts and unsupported capabilities fail before executor dispatch", async () => {
  for (const version of [null, "0.3", "1.1", "1.0.1"])
    expect(
      (await (await post(request("version", "direct"), version)).json()).error
        .code,
    ).toBe(-32009);
  for (const body of [
    [],
    null,
    { jsonrpc: "2.0", method: "SendMessage", params: {} },
    { jsonrpc: "1.0", id: 1, method: "SendMessage" },
  ])
    expect((await (await post(body)).json()).error.code).toBe(-32600);
  const old = request("old", "direct");
  old.method = "message/send";
  expect((await (await post(old)).json()).error.code).toBe(-32601);
  const role = request("role", "direct");
  role.params.message.role = "ROLE_AGENT";
  expect((await (await post(role)).json()).error.code).toBe(-32602);
  const parts = request("file", "direct");
  Object.assign(parts.params.message, {
    parts: [{ url: "http://169.254.169.254/" }],
  });
  expect((await (await post(parts)).json()).error.code).toBe(-32005);
  const tenant = request("tenant", "direct");
  Object.assign(tenant.params, { tenant: "other" });
  expect((await (await post(tenant)).json()).error.code).toBe(-32602);
  for (const method of A2A_PROFILE.unsupportedMethods) {
    const data = await (
      await post({ jsonrpc: "2.0", id: method, method, params: {} })
    ).json();
    expect(data.error.code).toBe(
      method.includes("PushNotification") ? -32003 : -32004,
    );
  }
  expect(
    (
      await (
        await post(request("config", "direct", { returnImmediately: "yes" }))
      ).json()
    ).error.code,
  ).toBe(-32602);
});

test("method/media/body limits and malformed JSON are bounded", async () => {
  expect((await fetch(new URL(A2A_PROFILE.rpcPath, server.url))).status).toBe(
    405,
  );
  expect(
    (
      await post(request("media", "direct"), "1.0", {
        "content-type": "text/plain",
      })
    ).status,
  ).toBe(415);
  expect(
    (await post(request("large", "x".repeat(A2A_PROFILE.maxRequestBytes))))
      .status,
  ).toBe(413);
  const response = await fetch(new URL(A2A_PROFILE.rpcPath, server.url), {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0" },
    body: "{",
  });
  expect((await response.json()).error.code).toBe(-32700);
});

test("SDK consumer cancellation leaves an incomplete stored task: production must own background reconciliation", async () => {
  const completedBefore = completedExecutions,
    cancelledBefore = cancelCalls;
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    executor,
  );
  const http = createSdkHttpHandler(handler);
  const payload = request("stop-consumer", "task");
  payload.method = "SendStreamingMessage";
  const response = await http(
    new Request("http://fixture/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify(payload),
    }),
    context(),
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('"task"');
  await reader.cancel();
  reader.releaseLock();
  // The executor finishes, but the demo store no longer consumes its status update.
  // Characterise this gap explicitly: do not use this demo handler for durable work.
  await Bun.sleep(25);
  expect(completedExecutions).toBe(completedBefore + 1);
  expect(cancelCalls).toBe(cancelledBefore);
  const tasks = await handler.listTasks({ pageSize: 100 } as never, context());
  expect(tasks.tasks).toHaveLength(1);
  expect(tasks.tasks[0].status?.state).toBe(TaskState.TASK_STATE_WORKING);
});

test("known version fails on old tool JSON and bounded invalid configuration before coercion", async () => {
  const legacy = request("legacy-part", "direct");
  Object.assign(legacy.params.message, {
    parts: [{ kind: "text", text: "legacy" }],
  });
  expect((await (await post(legacy)).json()).error.code).toBe(-32005);
  for (const config of [
    { historyLength: -1 },
    { historyLength: 1.5 },
    { historyLength: "5" },
    [],
    { taskPushNotificationConfig: { url: "http://fixture/callback" } },
  ]) {
    const payload = request("bad-config", "direct");
    Object.assign(payload.params, { configuration: config });
    const result = await (await post(payload)).json();
    expect(result.error.code).toBe(
      "taskPushNotificationConfig" in config ? -32003 : -32602,
    );
  }
});

test("unexpected runtime/storage error text is never included in the public JSON-RPC envelope", async () => {
  const failing = {
    getAgentCard: async () => card,
    sendMessage: async () => {
      throw new Error("secret fixture provider credential");
    },
  } as any;
  const http = createSdkHttpHandler(failing);
  const response = await http(
    new Request("https://fixture/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify(request("secret-error", "direct")),
    }),
    context(),
  );
  const text = await response.text();
  expect(text).not.toContain("secret fixture");
  expect(JSON.parse(text).error.code).toBe(-32603);
});
