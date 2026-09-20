import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createA2aServer } from "./server.js";
import { A2aTaskStore, type PublicOperation } from "./task-store.js";
import type { OperationAdapter } from "./runtime-api.js";
import type { A2aConfig } from "./config.js";
const enabled =
  process.env.QIUSHUIAI_E2E_DISPOSABLE === "1" && !!process.env.QIUSHUIAI_A2A_PYTHON;
(enabled ? test : test.skip)(
  "independent Python A2A SDK 1.1.2 exercises actual HTTP discovery/tasks/cancel/SSE",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "a2a-python-"));
    const store = new A2aTaskStore(dir);
    const ops = new Map<string, PublicOperation>(),
      keys = new Map<string, string>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let calls = 0;
    const config: A2aConfig = {
      enabled: true,
      inbound: true,
      outbound: false,
      publicBaseUrl: "https://fixture.invalid",
      agents: [
        { id: "echo", name: "Echo", description: "fixture", enabled: true },
      ],
      principals: [
        {
          id: "python",
          credentialKey: "fixture/python",
          targets: ["echo"],
          enabled: true,
        },
      ],
      endpoints: [],
    };
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
                status: "working",
                sequence: 2,
                output: null,
                reason: null,
                updatedAt: new Date().toISOString(),
              });
              if (input.text === "complete-stream") {
                const op = ops.get(id)!;
                timers.push(
                  setTimeout(
                    () =>
                      Object.assign(op, {
                        status: "completed",
                        sequence: 3,
                        output: "independent Python stream",
                        updatedAt: new Date().toISOString(),
                      }),
                    50,
                  ),
                );
              }
            }
            return {
              created,
              admission: "allow",
              operation: { ...ops.get(id)! },
            };
          },
          async get(id) {
            return { ...ops.get(id)! };
          },
          async cancel(id) {
            const op = ops.get(id)!;
            Object.assign(op, {
              status: "cancelled",
              sequence: op.sequence + 1,
            });
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
    const service = createA2aServer(
      () => config,
      store,
      adapter,
      async () => "independent-python-fixture-token",
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => service.handle(req),
    });
    try {
      const proc = Bun.spawn(
        [
          process.env.QIUSHUIAI_A2A_PYTHON!,
          new URL("./python-peer.py", import.meta.url).pathname,
          server.url.href.replace(/\/$/, ""),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code, err + "\n" + out).toBe(0);
      expect(out).toContain("PYTHON-A2A-PASS");
      expect(calls).toBe(2);
    } finally {
      service.close();
      await service.drained();
      server.stop(true);
      for (const timer of timers) clearTimeout(timer);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
