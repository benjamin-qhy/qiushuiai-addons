import { A2aConfigStore, EMPTY_CONFIG, validateConfig } from "./config.js";
import { A2aTaskStore } from "./task-store.js";
import { A2aClientStore } from "./client-store.js";
import { A2aOutboundClient } from "./client.js";
import { createA2aServer } from "./server.js";
import { resolveA2aSecret, type SecretResolver } from "./security.js";
import {
  a2aHostApi,
  type A2aHostApi,
  type OperationAdapter,
} from "./runtime-api.js";
import { A2A_PROFILE } from "./profile.js";

type Registrar = (
  id: string,
  action: string,
  handlers: { get: () => unknown; set?: (value: unknown) => unknown },
  directory: string,
) => void;
export class A2aService {
  private readonly configStore: A2aConfigStore;
  private tasks: A2aTaskStore | null = null;
  private outboundStore: A2aClientStore | null = null;
  private outboundClient: A2aOutboundClient | null = null;
  private server: ReturnType<typeof createA2aServer> | null = null;
  private adapter: OperationAdapter;
  private unregister: () => void;
  private stopped = false;
  constructor(
    private readonly host: A2aHostApi,
    private readonly directory: string,
    private readonly secrets: SecretResolver = resolveA2aSecret,
  ) {
    this.configStore = new A2aConfigStore(directory);
    this.adapter = host.operations.register();
    // Host routing is registered once at startup. Handler returns 404 until explicit opt-in.
    this.unregister = host.externalRoutes.register({
      addonId: "a2a",
      prefix: "/api/addons/a2a",
      methods: ["GET", "POST"],
      maxBodyBytes: A2A_PROFILE.maxRequestBytes,
      handler: (req) => this.handle(req),
    });
    host.lifecycle.onShutdown(() => this.close());
  }
  config() {
    return this.configStore.read();
  }
  diagnostics() {
    this.singleUser();
    return {
      status: this.status(),
      tasks: this.tasks
        ? this.config().principals.map((p) => ({
            principal: p.id,
            tasks: this.tasks!.list(p.id, null, 50).map((r) => ({
              id: r.id,
              target: r.target,
              state: r.task.status?.state,
              operationId: r.operationId,
            })),
          }))
        : [],
    };
  }
  prune(principal: string, before: string) {
    this.singleUser();
    if (!this.config().principals.some((p) => p.id === principal))
      throw new Error("Configured principal required.");
    return { removed: this.tasks?.pruneTerminal(principal, before) ?? 0 };
  }
  private singleUser() {
    // The core bound API rejects family/isolated contexts, including outbound calls.
    this.adapter.forPrincipal("local-status");
  }
  status() {
    this.singleUser();
    const config = this.config();
    return {
      enabled: config.enabled,
      stage: "service-candidate",
      networkActive: !!this.server,
      inbound: config.inbound,
      outbound: config.outbound,
      stopped: this.stopped,
      profile: A2A_PROFILE,
      activeRequests: this.server?.activeRequests() ?? 0,
    };
  }
  async setConfig(value: unknown) {
    this.singleUser();
    const next = validateConfig(value);
    if (this.stopped) throw new Error("A2A runtime has shut down.");
    // Close active transport consumers before changing any credentials/grants. Core work persists.
    const previous = this.server;
    previous?.close();
    this.server = null;
    const client = this.outboundClient;
    this.outboundClient = null;
    const config = this.configStore.write(next);
    await Promise.all([previous?.drained(), client?.shutdown()]);
    return config;
  }
  private async handle(req: Request): Promise<Response> {
    if (this.stopped) return new Response("A2A stopped", { status: 503 });
    const config = this.config();
    if (!config.enabled || !config.inbound)
      return new Response("Not found", { status: 404 });
    this.singleUser();
    if (!this.tasks) this.tasks = new A2aTaskStore(this.directory);
    if (!this.server)
      this.server = createA2aServer(
        () => this.config(),
        this.tasks,
        this.adapter,
        this.secrets,
      );
    return this.server.handle(req);
  }
  outboundWork() {
    this.singleUser();
    if (!this.adapter.admitOutbound)
      throw new Error("Host outbound work admission unavailable.");
    return this.adapter.admitOutbound();
  }
  client() {
    this.singleUser();
    const config = this.config();
    if (this.stopped || !config.enabled || !config.outbound)
      throw new Error("Outbound A2A disabled.");
    if (!this.outboundStore)
      this.outboundStore = new A2aClientStore(this.directory);
    return (this.outboundClient ??= new A2aOutboundClient(
      () => this.config(),
      this.outboundStore,
      this.secrets,
      () => {
        this.singleUser();
        if (this.stopped) throw new Error("A2A stopped");
        this.outboundWork();
      },
    ));
  }
  async close() {
    if (this.stopped) return;
    this.stopped = true;
    this.unregister();
    const server = this.server;
    server?.close();
    this.server = null;
    await Promise.all([server?.drained(), this.outboundClient?.shutdown()]);
    this.outboundClient = null;
    this.tasks?.close();
    this.tasks = null;
    this.outboundStore?.close();
    this.outboundStore = null;
  }
}
const singleton = Symbol.for("piclaw.a2a.service.v1");
export function currentA2aService(): A2aService | null {
  return (globalThis as any)[singleton] ?? null;
}
export function startA2aRuntime(): A2aService | null {
  const existing = currentA2aService();
  if (existing) return existing;
  const host = a2aHostApi();
  if (!host) return null;
  const service = new A2aService(host, host.messaging.getAddonDataDir("a2a"));
  (globalThis as any)[singleton] = service;
  host.lifecycle.onShutdown(async () => {
    await service.close();
    if (currentA2aService() === service) delete (globalThis as any)[singleton];
  });
  const registrar = (globalThis as any).__piclaw_registerAddonConfigApi as
    Registrar | undefined;
  registrar?.(
    "a2a",
    "config",
    {
      get: () => service.config(),
      set: async (value) => ({
        ok: true,
        config: await service.setConfig(value),
      }),
    },
    import.meta.dir,
  );
  registrar?.(
    "a2a",
    "status",
    { get: () => service.status() },
    import.meta.dir,
  );
  registrar?.(
    "a2a",
    "tasks",
    {
      get: () => service.diagnostics(),
      set: (value: any) => service.prune(value?.principal, value?.before),
    },
    import.meta.dir,
  );
  return service;
}
export function a2aServiceStatus() {
  const service = currentA2aService();
  return service
    ? service.status()
    : {
        enabled: false,
        stage: "runtime-unavailable",
        networkActive: false,
        profile: A2A_PROFILE,
        config: EMPTY_CONFIG,
        blockedBy: ["operations-api-v1"],
      };
}
export function requireA2aService(): A2aService {
  const service = currentA2aService();
  if (!service)
    throw new Error(
      "A2A requires the generic operations API v1; no raw enqueue fallback.",
    );
  return service;
}
