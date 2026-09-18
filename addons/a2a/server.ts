import { createHash } from "node:crypto";
import { signCard } from "./card-security.js";
import { AgentCard } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { A2aRequestHandler, REQUEST_SIGNAL } from "./handler.js";
import { createSdkHttpHandler } from "./sdk-http.js";
import { A2aTaskStore } from "./task-store.js";
import type { A2aConfig } from "./config.js";
import {
  authenticateA2a,
  authorizeTarget,
  type SecretResolver,
} from "./security.js";
import type { OperationAdapter } from "./runtime-api.js";

/** Already bounded by core route guards. Own auth, publication and stream lifetime. */
export function createA2aServer(
  config: () => A2aConfig,
  store: A2aTaskStore,
  operations: OperationAdapter,
  secrets: SecretResolver,
) {
  let active = 0,
    closed = false;
  let authenticating = 0;
  let signingPending = 0;
  const requests = new Set<AbortController>();
  const quota = new Map<string, { start: number; count: number }>();
  const idleWaiters = new Set<() => void>();
  return {
    async handle(req: Request): Promise<Response> {
      const cfg = config();
      if (closed || !cfg.enabled || !cfg.inbound)
        return new Response("A2A disabled", { status: 404 });
      const path = new URL(req.url).pathname;
      const match =
        /^\/api\/addons\/a2a\/agents\/([A-Za-z0-9_.-]{1,80})\/(agent-card\.json|rpc)$/.exec(
          path,
        );
      if (!match) return new Response("Not found", { status: 404 });
      if (active >= 16 || authenticating >= 16 || signingPending >= 16)
        return new Response("Concurrency limit", { status: 429 });
      active++;
      const controller = new AbortController();
      requests.add(controller);
      const abort = () =>
        controller.abort(req.signal.reason ?? new Error("Request closed"));
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) abort();
      const timer = setTimeout(
        () => controller.abort(new Error("A2A transport deadline")),
        30000,
      );
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        req.signal.removeEventListener("abort", abort);
        requests.delete(controller);
        active--;
        if (active === 0) {
          for (const resolve of idleWaiters) resolve();
          idleWaiters.clear();
        }
      };
      let handedOff = false;
      try {
        let principal;
        try {
          authenticating++;
          const pending = authenticateA2a(req, cfg, secrets).finally(() => {
            authenticating--;
          });
          principal = await abortable(pending, controller.signal);
        } catch {
          return new Response("Authentication unavailable", { status: 503 });
        }
        if (closed) return new Response("A2A stopped", { status: 503 });
        if (!principal)
          return new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": "Bearer" },
          });
        const target = match[1];
        if (!authorizeTarget(config(), principal.id, target))
          return new Response("Not found", { status: 404 });
        const now = Date.now(),
          bucket = quota.get(principal.id);
        if (!bucket || now - bucket.start >= 60000)
          quota.set(principal.id, { start: now, count: 1 });
        else if (++bucket.count > 120)
          return new Response("Rate limit", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        const handler = new A2aRequestHandler(
          target,
          config,
          store,
          operations,
          secrets,
        );
        if (match[2] === "agent-card.json") {
          if (req.method !== "GET")
            return new Response("Method not allowed", {
              status: 405,
              headers: { Allow: "GET" },
            });
          const raw = AgentCard.toJSON(await handler.getAgentCard()) as Record<
            string,
            unknown
          >;
          const signing = config().agents.find(
            (a) => a.id === target,
          )?.cardSigning;
          let card = raw;
          if (signing) {
            signingPending++;
            const pending = signCard(raw, signing, secrets).finally(() => {
              signingPending--;
            });
            card = await abortable(pending, controller.signal);
          }
          controller.signal.throwIfAborted();
          if (
            !authorizeTarget(config(), principal.id, target) ||
            JSON.stringify(
              config().agents.find((a) => a.id === target)?.cardSigning,
            ) !== JSON.stringify(signing)
          )
            return new Response("Not found", { status: 404 });
          const etag =
            '"' +
            createHash("sha256")
              .update(JSON.stringify([principal.id, card]))
              .digest("hex") +
            '"';
          const headers = {
            "Cache-Control": "private, no-cache",
            ETag: etag,
            Vary: "Authorization",
          };
          if (req.headers.get("if-none-match") === etag)
            return new Response(null, { status: 304, headers });
          return Response.json(card, { headers });
        }
        const context = new ServerCallContext({
          user: { isAuthenticated: true, userName: principal.id },
          requestedVersion: "1.0",
          state: new Map([[REQUEST_SIGNAL, controller.signal]]),
        });
        const response = await createSdkHttpHandler(handler)(
          req,
          context,
          controller.signal,
        );
        if (
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          finish();
          return response;
        }
        const reader = response.body.getReader();
        let streamDone = false;
        const cancelReader = async () => {
          try {
            await reader.cancel();
          } finally {
            finish();
          }
        };
        const onAbort = () => {
          if (streamDone) return;
          streamDone = true;
          void cancelReader().catch(() => finish());
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        const end = () => {
          streamDone = true;
          controller.signal.removeEventListener("abort", onAbort);
          finish();
        };
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(output) {
              try {
                if (controller.signal.aborted)
                  throw new Error("A2A stream closed");
                const next = await reader.read();
                if (next.done) {
                  end();
                  output.close();
                } else output.enqueue(next.value);
              } catch (error) {
                end();
                output.error(error);
              }
            },
            async cancel() {
              controller.abort(new Error("A2A consumer closed"));
              try {
                await cancelReader();
              } finally {
                end();
              }
            },
          },
          { highWaterMark: 0 },
        );
        if (controller.signal.aborted) onAbort();
        handedOff = true;
        return new Response(body, {
          status: response.status,
          headers: response.headers,
        });
      } catch {
        finish();
        return new Response("A2A request failed", {
          status: controller.signal.aborted ? 504 : 500,
        });
      } finally {
        if (!handedOff) finish();
      }
    },
    close() {
      closed = true;
      for (const controller of requests)
        controller.abort(new Error("A2A shutdown"));
      quota.clear();
    },
    activeRequests() {
      return active;
    },
    drained() {
      return active === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
  };
}

/** Bound the request wait even if an external keychain provider ignores cancellation.
 * The authenticating counter retains its slot until the provider itself settles. */
async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error("Request closed"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
