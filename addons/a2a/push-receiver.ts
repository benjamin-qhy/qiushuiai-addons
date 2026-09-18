import { createHash } from "node:crypto";
import type { A2aConfig } from "./config.js";
import type { SecretResolver } from "./security.js";
import { sameCredential } from "./push-policy.js";
import { validatePushPayload } from "./push-store.js";
import { A2aClientStore } from "./client-store.js";
import { endpointIdentity } from "./client.js";
import { parseCardJson } from "./card-json.js";

/** Authenticated inbox only; not an agent-message entry point. Body is validated but not stored. */
export function createPushReceiver(
  config: () => A2aConfig,
  store: () => A2aClientStore,
  secrets: SecretResolver,
) {
  let authenticating = 0;
  const controllers = new Set<AbortController>(),
    quota = new Map<string, { at: number; n: number }>();
  const drained = new Set<() => void>();
  const handle = async (req: Request, id: string): Promise<Response> => {
    const cfg = config(),
      receiver = cfg.push?.receivers.find((r) => r.id === id && r.enabled);
    if (!cfg.enabled || !cfg.outbound || !cfg.push?.enabled || !receiver)
      return new Response("Not found", { status: 404 });
    if (req.method !== "POST")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    if (controllers.size >= 8 || authenticating >= 8)
      return new Response("Busy", { status: 429 });
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort(new Error("Push receiver closed"));
    req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
    const timer = setTimeout(abort, 10000);
    try {
      if (
        req.headers.get("content-type")?.split(";")[0].trim() !==
        "application/a2a+json"
      )
        return new Response("Unsupported media type", { status: 415 });
      const auth = req.headers.get("authorization");
      if (!auth?.startsWith("Bearer ") || auth.length > 4096)
        return new Response("Unauthorized", { status: 401 });
      authenticating++;
      const secret = await abortable(
        secrets(receiver.credentialKey).finally(() => {
          authenticating--;
        }),
        controller.signal,
      );
      if (
        !secret ||
        secret.length < 24 ||
        !sameCredential(auth.slice(7), secret)
      )
        return new Response("Unauthorized", { status: 401 });
      const current = () => {
        const c = config();
        return (
          c.enabled &&
          c.outbound &&
          c.push?.enabled &&
          JSON.stringify(c.push.receivers.find((r) => r.id === id)) ===
            JSON.stringify(receiver)
        );
      };
      if (!current()) return new Response("Not found", { status: 404 });
      const endpoint = config().endpoints.find(
        (e) => e.alias === receiver.endpoint && e.enabled,
      );
      if (!endpoint) return new Response("Not found", { status: 404 });
      const now = Date.now(),
        bucket = quota.get(id);
      if (!bucket || now - bucket.at >= 60000) quota.set(id, { at: now, n: 1 });
      else if (++bucket.n > 120)
        return new Response("Rate limit", { status: 429 });
      if (!req.body)
        return new Response("Invalid notification", { status: 400 });
      const reader = req.body.getReader(),
        cancel = () => {
          void reader.cancel().catch(() => false);
        };
      controller.signal.addEventListener("abort", cancel, { once: true });
      let size = 0;
      const parts: Uint8Array[] = [];
      try {
        for (;;) {
          controller.signal.throwIfAborted();
          const next = await reader.read();
          controller.signal.throwIfAborted();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 256 * 1024) {
            await reader.cancel();
            return new Response("Too large", { status: 413 });
          }
          parts.push(next.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const raw = new TextDecoder("utf8", { fatal: true }).decode(bytes),
        payload = parseCardJson(raw) as Record<string, any>;
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return new Response("Invalid notification", { status: 400 });
      const kind = Object.keys(payload)[0],
        taskId = kind === "task" ? payload.task?.id : payload[kind]?.taskId;
      if (typeof taskId !== "string" || !taskId || taskId.length > 128)
        return new Response("Invalid task", { status: 400 });
      validatePushPayload(taskId, payload);
      const delivery =
        req.headers.get("a2a-delivery-id") ||
        "sha256:" + createHash("sha256").update(raw).digest("hex");
      if (delivery.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(delivery))
        return new Response("Invalid delivery ID", { status: 400 });
      controller.signal.throwIfAborted();
      if (
        !current() ||
        JSON.stringify(
          config().endpoints.find(
            (e) => e.alias === receiver.endpoint && e.enabled,
          ),
        ) !== JSON.stringify(endpoint)
      )
        return new Response("Not found", { status: 404 });
      const created = store().receivePush(
        id,
        endpointIdentity(endpoint),
        delivery,
        taskId,
        raw,
      );
      return new Response(null, { status: created ? 202 : 204 });
    } catch {
      return new Response("Notification rejected", { status: 400 });
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener("abort", abort);
      controllers.delete(controller);
      if (!controllers.size) {
        for (const done of drained) done();
        drained.clear();
      }
    }
  };
  return {
    handle,
    async close() {
      for (const c of controllers) c.abort(new Error("Push receiver shutdown"));
      if (controllers.size)
        await new Promise<void>((resolve) => drained.add(resolve));
      quota.clear();
    },
    active() {
      return controllers.size;
    },
  };
}
export async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error("Cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
