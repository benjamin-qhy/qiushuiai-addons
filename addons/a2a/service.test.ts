import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { A2aService } from "./service.js";
import { EMPTY_CONFIG } from "./config.js";
import { a2aHostApi, type A2aHostApi } from "./runtime-api.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "a2a-runtime-"));
  dirs.push(dir);
  let route: any;
  let removed = 0;
  let family = false;
  const cleanup: Array<() => void | Promise<void>> = [];
  const host: A2aHostApi = {
    messaging: { version: 1, getAddonDataDir: () => dir },
    lifecycle: {
      version: 1,
      onShutdown(fn) {
        cleanup.push(fn);
        return () => {};
      },
    },
    operations: {
      version: 1,
      register: () => ({
        forPrincipal() {
          if (family) throw new Error("family denied");
          return {
            version: 1,
            admit: async () => ({
              created: false,
              admission: "rejected",
              operation: null,
            }),
            get: async () => {
              throw new Error("not found");
            },
            cancel: async () => {
              throw new Error("not found");
            },
            continue: async () => {
              throw new Error("not found");
            },
            resume: async () => {
              throw new Error("not found");
            },
          };
        },
      }),
    },
    externalRoutes: {
      version: 1,
      register(input) {
        route = input;
        return () => {
          removed++;
        };
      },
    },
  };
  const service = new A2aService(
    host,
    dir,
    async () => "test-only-credential-longer-than-24",
  );
  return {
    dir,
    service,
    route: () => route,
    removed: () => removed,
    family: () => {
      family = true;
    },
    cleanup,
  };
}

test("disabled runtime creates no database, cannot send, registers bounded owned route and removes it on shutdown", async () => {
  const f = fixture();
  try {
    expect(f.service.config()).toEqual(EMPTY_CONFIG);
    expect(f.service.status()).toMatchObject({
      enabled: false,
      networkActive: false,
    });
    expect(readdirSync(f.dir)).toEqual([]);
    expect(f.route()).toMatchObject({
      addonId: "a2a",
      prefix: "/api/addons/a2a",
      methods: ["GET", "POST"],
      maxBodyBytes: 262144,
    });
    expect(
      (
        await f
          .route()
          .handler(
            new Request("https://fixture/api/addons/a2a/agents/echo/rpc"),
          )
      ).status,
    ).toBe(404);
    expect(() => f.service.client()).toThrow("disabled");
    await f.service.setConfig({ ...EMPTY_CONFIG, outbound: true });
    expect(f.service.config().enabled).toBe(false);
    expect(readdirSync(f.dir)).toEqual(["config.json"]);
    f.family();
    expect(() => f.service.status()).toThrow("family denied");
    await expect(f.service.setConfig(EMPTY_CONFIG)).rejects.toThrow(
      "family denied",
    );
  } finally {
    await f.service.close();
    for (const callback of f.cleanup) await callback();
  }
  expect(f.removed()).toBe(1);
});

test("host capability negotiation never substitutes unscoped messaging for operations", () => {
  const original = (globalThis as any).__qiushuiai_runtime;
  try {
    for (const api of [
      undefined,
      {},
      { operations: { version: 2 } },
      {
        operations: { version: 1 },
        messaging: { version: 1 },
        lifecycle: { version: 1 },
      },
    ]) {
      (globalThis as any).__qiushuiai_runtime = api;
      expect(a2aHostApi()).toBeNull();
    }
  } finally {
    (globalThis as any).__qiushuiai_runtime = original;
  }
});
