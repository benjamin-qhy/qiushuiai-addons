import { abortable } from "./push-receiver.js";
import type { A2aConfig } from "./config.js";
import type { OperationAdapter } from "./runtime-api.js";
import { A2aTaskStore } from "./task-store.js";
import { callbackGrant, pushEnabled } from "./push-policy.js";
import type { SecretResolver } from "./security.js";
import { pinnedEndpointFetch } from "./pinned-fetch.js";
import type { PushDelivery } from "./push-store.js";

/** Single-owner dispatcher. Durable events/outbox remain in task SQLite, not timer memory. */
export class A2aPushWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | null = null;
  private controller = new AbortController();
  private cursor = 0;
  constructor(
    private readonly config: () => A2aConfig,
    private readonly store: A2aTaskStore,
    private readonly operations: OperationAdapter,
    private readonly secrets: SecretResolver,
    private readonly now = () => Date.now(),
  ) {}
  start() {
    if (this.timer || this.active || this.stopped) return;
    this.store.push.recover(this.now());
    this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule());
    }, 500);
    this.timer.unref?.();
  }
  tick(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopped) return Promise.resolve();
    this.active = this.cycle()
      .catch(() => {
        this.errors++;
      })
      .finally(() => {
        this.active = null;
      });
    return this.active;
  }
  private errors = 0;
  stats() {
    return {
      running: !this.stopped,
      active: !!this.active,
      errors: this.errors,
    };
  }
  private async cycle() {
    if (!pushEnabled(this.config())) return;
    // Core context/mode denial is not bypassed by background dispatch.
    this.operations.forPrincipal("push-runtime-check");
    const watch = this.store.push.watched();
    for (let n = 0; n < Math.min(watch.length, 32); n++) {
      if (this.stopped) return;
      const row = watch[(this.cursor + n) % watch.length];
      const record = this.store.get(row.principal, row.taskId);
      const anyGrant = this.store.push
        .list(row.principal, row.taskId)
        .some(
          (c) =>
            !!callbackGrant(this.config(), row.principal, record.target, c.url),
        );
      if (!anyGrant) {
        this.store.push.revokeTask(row.principal, row.taskId);
        continue;
      }
      if (!record.operationId) continue;
      try {
        const client = this.operations.forPrincipal(row.principal);
        // New core events are optional during compatibility negotiation; production
        // must provide durable events before this capability can be enabled.
        if (!client.events)
          throw new Error("Push requires core durable event retrieval.");
        const result = await abortable(
          client.events(record.operationId, record.sequence),
          AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
        );
        if (this.stopped) return;
        for (const event of result.events)
          this.store.sync(row.principal, row.taskId, event.snapshot);
        // A reported replay gap is repaired with the current snapshot, never by reexecution.
        if (
          result.snapshot.sequence >
          this.store.get(row.principal, row.taskId).sequence
        )
          this.store.sync(row.principal, row.taskId, result.snapshot);
      } catch (error) {
        if (isAccessDenied(error))
          this.store.push.revokeTask(row.principal, row.taskId);
        else this.errors++;
      }
    }
    if (watch.length) this.cursor = (this.cursor + 32) % watch.length;
    this.store.push.pruneSettled(this.now() - 24 * 60 * 60 * 1000);
    for (let n = 0; n < 8 && !this.stopped; n++) {
      const delivery = this.store.push.claim(this.now());
      if (!delivery) break;
      await this.deliver(delivery);
    }
  }
  private async deliver(delivery: PushDelivery) {
    const lease = delivery.lease!;
    const task = this.store.get(delivery.principal, delivery.taskId);
    const config = this.store.push.get(
      delivery.principal,
      delivery.taskId,
      delivery.configId,
    );
    const grant = config
      ? callbackGrant(
          this.config(),
          delivery.principal,
          task.target,
          config.url,
        )
      : null;
    if (
      !grant ||
      !config ||
      grant.credentialKey !== config.credentialKey ||
      grant.allowPrivate !== config.allowPrivate
    ) {
      this.store.push.settle(delivery.id, lease, false, false, this.now());
      return;
    }
    const admission = () => {
      if (this.stopped || !this.store.push.current(delivery))
        throw new Error("Push delivery revoked.");
      const current = callbackGrant(
        this.config(),
        delivery.principal,
        task.target,
        config.url,
      );
      if (!current || JSON.stringify(current) !== JSON.stringify(grant))
        throw new Error("Push policy changed.");
    };
    try {
      // Read current core ownership/grant even for a terminal task; no source bypass.
      if (task.operationId)
        await abortable(
          this.operations
            .forPrincipal(delivery.principal)
            .get(task.operationId),
          AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
        );
      admission();
      const transport = pinnedEndpointFetch(
        {
          alias: grant.id,
          cardUrl: grant.url,
          credentialKey: grant.credentialKey,
          allowPrivate: grant.allowPrivate,
          enabled: true,
        },
        async (name) => {
          const secret = await abortable(
            this.secrets(name),
            AbortSignal.any([
              this.controller.signal,
              AbortSignal.timeout(10000),
            ]),
          );
          admission();
          return secret;
        },
        async () => {
          if (task.operationId)
            await abortable(
              this.operations
                .forPrincipal(delivery.principal)
                .get(task.operationId),
              AbortSignal.any([
                this.controller.signal,
                AbortSignal.timeout(10000),
              ]),
            );
          admission();
        },
        256 * 1024,
      );
      const response = await transport(config.url, {
        method: "POST",
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(10000),
        ]),
        headers: {
          "Content-Type": "application/a2a+json",
          "A2A-Version": "1.0",
          "A2A-Delivery-Id": delivery.id,
        },
        body: delivery.payload,
      });
      await response.body?.cancel();
      admission();
      const success = response.status >= 200 && response.status < 300;
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      this.store.push.settle(
        delivery.id,
        lease,
        success,
        retryable,
        this.now(),
      );
    } catch (error) {
      if (isAccessDenied(error)) {
        this.store.push.revokeTask(delivery.principal, delivery.taskId);
        return;
      }
      // Conservative bounded retries for ambiguous delivery; same ID/bytes retained.
      if (!this.stopped)
        this.store.push.settle(delivery.id, lease, false, true, this.now());
    }
  }
  async close() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller.abort(new Error("Push stopped"));
    await this.active;
  }
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.name === "OperationAccessError";
}
