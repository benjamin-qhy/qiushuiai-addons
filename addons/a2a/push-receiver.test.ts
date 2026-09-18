import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushReceiver } from "./push-receiver.js";
import { A2aClientStore } from "./client-store.js";
import { endpointIdentity } from "./client.js";
import type { A2aConfig } from "./config.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const secret = "disposable-notification-key-123456789";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "a2a-push-inbox-"));
  dirs.push(dir);
  const store = new A2aClientStore(dir);
  const cfg: A2aConfig = {
    enabled: true,
    inbound: false,
    outbound: true,
    publicBaseUrl: "",
    principals: [],
    agents: [],
    endpoints: [
      {
        alias: "remote",
        cardUrl: "https://remote.invalid/card",
        enabled: true,
        allowPrivate: false,
      },
    ],
    push: {
      enabled: true,
      callbacks: [],
      receivers: [
        {
          id: "sink",
          endpoint: "remote",
          credentialKey: "push/receiver",
          enabled: true,
        },
      ],
    },
  };
  store.remember("work", endpointIdentity(cfg.endpoints[0]), "task", "context");
  const receiver = createPushReceiver(
    () => cfg,
    () => store,
    async () => secret,
  );
  const req = (payload: unknown, delivery = "d1", auth = secret) =>
    new Request("https://local.invalid/api/addons/a2a/push/sink", {
      method: "POST",
      headers: {
        "Content-Type": "application/a2a+json",
        authorization: "Bearer " + auth,
        "a2a-delivery-id": delivery,
      },
      body: JSON.stringify(payload),
    });
  return { cfg, store, receiver, req, dir };
}
const update = {
  statusUpdate: {
    taskId: "task",
    contextId: "context",
    status: { state: "TASK_STATE_COMPLETED" },
  },
};

test("receiver authenticates, rejects unknown tasks and deduplicates/conflict-checks deliveries without model execution", async () => {
  const f = setup();
  try {
    expect(
      (await f.receiver.handle(f.req(update, "d", "wrong"), "sink")).status,
    ).toBe(401);
    expect(
      (
        await f.receiver.handle(
          f.req({ task: { id: "foreign" } }, "foreign"),
          "sink",
        )
      ).status,
    ).toBe(400);
    expect((await f.receiver.handle(f.req(update), "sink")).status).toBe(202);
    expect((await f.receiver.handle(f.req(update), "sink")).status).toBe(204);
    expect(
      (await f.receiver.handle(f.req({ task: { id: "task" } }), "sink")).status,
    ).toBe(400);
    f.cfg.push!.receivers[0].enabled = false;
    expect(
      (await f.receiver.handle(f.req(update, "next"), "sink")).status,
    ).toBe(404);
  } finally {
    await f.receiver.close();
    f.store.close();
  }
});

test("receiver aborts stalled body on shutdown, never calls the store after close", async () => {
  const f = setup();
  let cancelled = false;
  try {
    const req = new Request("https://fixture/push", {
      method: "POST",
      headers: {
        "content-type": "application/a2a+json",
        authorization: "Bearer " + secret,
      },
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    });
    const result = f.receiver.handle(req, "sink");
    await Bun.sleep(1);
    await f.receiver.close();
    expect((await result).status).toBe(400);
    expect(cancelled).toBe(true);
    expect(f.receiver.active()).toBe(0);
  } finally {
    await f.receiver.close();
    f.store.close();
  }
});

test("receiver task scope changes when endpoint identity is replaced; persistent replay hash survives reopen", async () => {
  const f = setup();
  try {
    expect((await f.receiver.handle(f.req(update), "sink")).status).toBe(202);
    f.store.close();
    const reopened = new A2aClientStore(f.dir),
      receiver = createPushReceiver(
        () => f.cfg,
        () => reopened,
        async () => secret,
      );
    try {
      expect((await receiver.handle(f.req(update), "sink")).status).toBe(204);
      f.cfg.endpoints[0].cardUrl = "https://different.invalid/card";
      expect(
        (await receiver.handle(f.req(update, "fresh"), "sink")).status,
      ).toBe(400);
    } finally {
      await receiver.close();
      reopened.close();
    }
  } finally {
    await f.receiver.close();
  }
});
