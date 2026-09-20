import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2aTaskStore, type PublicOperation } from "./task-store.js";
import { createA2aServer } from "./server.js";
import { A2aPushWorker } from "./push-worker.js";
import type { A2aConfig } from "./config.js";
import type { OperationAdapter } from "./runtime-api.js";
const enabled =
  process.env.QIUSHUIAI_E2E_DISPOSABLE === "1" && !!process.env.QIUSHUIAI_A2A_PYTHON;
(enabled ? test : test.skip)(
  "independent Python SDK push CRUD delivers authenticated StreamResponse without task polling",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "python-push-")),
      store = new A2aTaskStore(dir);
    const notifications: any[] = [];
    const sink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname === "/seen")
          return Response.json(notifications);
        notifications.push({
          auth: req.headers.get("authorization"),
          type: req.headers.get("content-type"),
          id: req.headers.get("a2a-delivery-id"),
          payload: await req.json(),
        });
        return new Response(null, { status: 204 });
      },
    });
    const cfg: A2aConfig = {
      enabled: true,
      inbound: true,
      outbound: false,
      publicBaseUrl: "https://fixture.invalid",
      principals: [
        {
          id: "python",
          credentialKey: "inbound",
          targets: ["echo"],
          enabled: true,
        },
      ],
      agents: [
        { id: "echo", name: "Echo", description: "test", enabled: true },
      ],
      endpoints: [],
      push: {
        enabled: true,
        callbacks: [
          {
            id: "callback",
            principal: "python",
            targets: ["echo"],
            url: new URL("/notify", sink.url).href,
            credentialKey: "callback",
            allowPrivate: true,
            enabled: true,
          },
        ],
        receivers: [],
      },
    };
    let op: PublicOperation = {
      id: "operation",
      status: "working",
      sequence: 2,
      output: null,
      reason: null,
      updatedAt: new Date().toISOString(),
    };
    const events: Array<{ sequence: number; snapshot: PublicOperation }> = [
      { sequence: 2, snapshot: { ...op } },
    ];
    const adapter: OperationAdapter = {
      forPrincipal() {
        return {
          version: 1,
          admit: async () => ({
            created: true,
            admission: "allow",
            operation: { ...op },
          }),
          get: async () => ({ ...op }),
          events: async (_id, after = 0) => ({
            snapshot: { ...op },
            events: events.filter((e) => e.sequence > after),
            gap: false,
          }),
          cancel: async () => ({ outcome: "not_cancellable", operation: op }),
          resume: async () => ({ resumed: false, operation: op }),
          continue: async () => ({ resumed: false, operation: op }),
        };
      },
    };
    const secrets = async (name: string) =>
      name === "inbound"
        ? "python-inbound-fixture-key-long"
        : "python-callback-fixture-key-long";
    const service = createA2aServer(() => cfg, store, adapter, secrets),
      worker = new A2aPushWorker(() => cfg, store, adapter, secrets);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/fixture/complete") {
          op = {
            ...op,
            status: "completed",
            sequence: 3,
            output: "push result",
            updatedAt: new Date().toISOString(),
          };
          events.push({ sequence: 3, snapshot: { ...op } });
          return new Response("ok");
        }
        return service.handle(req);
      },
    });
    worker.start();
    try {
      const child = Bun.spawn(
        [
          process.env.QIUSHUIAI_A2A_PYTHON!,
          new URL("./python-push-peer.py", import.meta.url).pathname,
          server.url.href.replace(/\/$/, ""),
          sink.url.href.replace(/\/$/, ""),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, err + "\n" + out).toBe(0);
      expect(out).toContain("PYTHON-PUSH-PASS");
      expect(notifications.length).toBeGreaterThanOrEqual(2);
    } finally {
      await worker.close();
      service.close();
      await service.drained();
      server.stop(true);
      sink.stop(true);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  20000,
);
