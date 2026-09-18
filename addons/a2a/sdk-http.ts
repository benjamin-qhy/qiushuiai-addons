import { validateParts } from "./parts.js";
/** Framework-free Request/Response binding, used by the disposable profile fixtures.
 * Authentication, target policy and durable storage MUST wrap this before host registration.
 * This module does not register a route or open a socket.
 */
import {
  JsonRpcTransportHandler,
  ServerCallContext,
  type A2ARequestHandler,
} from "@a2a-js/sdk/server";
import { A2A_PROFILE } from "./profile.js";

type JsonRecord = Record<string, unknown>;
function object(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function rpcError(
  id: unknown,
  code: number,
  message: string,
  status = 200,
): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: typeof id === "string" || typeof id === "number" ? id : null,
      error: { code, message },
    },
    { status },
  );
}
async function boundedBody(req: Request, signal: AbortSignal): Promise<string> {
  const declared = req.headers.get("content-length");
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > A2A_PROFILE.maxRequestBytes)
  )
    throw new Error("body limit");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => false);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > A2A_PROFILE.maxRequestBytes) {
        await reader.cancel();
        throw new Error("body limit");
      }
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export function createSdkHttpHandler(handler: A2ARequestHandler) {
  const rpc = new JsonRpcTransportHandler(handler);
  return async (
    req: Request,
    context: ServerCallContext,
    signal: AbortSignal = req.signal,
  ): Promise<Response> => {
    if (req.method !== "POST")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    const media = req.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (media !== "application/json" && media !== "application/a2a+json")
      return new Response("Unsupported media type", { status: 415 });
    let body: string;
    try {
      body = await boundedBody(req, signal);
    } catch {
      return rpcError(null, -32600, "Request body invalid or too large", 413);
    }
    let request: unknown;
    try {
      request = JSON.parse(body);
    } catch {
      return rpcError(null, -32700, "Parse error");
    }
    if (!object(request)) return rpcError(null, -32600, "Invalid Request");
    const id = request.id;
    if (
      request.jsonrpc !== "2.0" ||
      !(
        typeof id === "string" ||
        (typeof id === "number" && Number.isFinite(id))
      ) ||
      typeof request.method !== "string"
    )
      return rpcError(id, -32600, "Invalid Request");
    // Reject 0.3 and missing versions. No fallback/implicit compatibility surface.
    if (req.headers.get("a2a-version") !== A2A_PROFILE.wireVersion)
      return rpcError(id, -32009, "Unsupported A2A version");
    if (
      [
        ...A2A_PROFILE.unsupportedMethods,
        ...A2A_PROFILE.optInPushMethods,
      ].includes(request.method as never) &&
      !(
        request.method.includes("PushNotification") &&
        (await handler.getAgentCard()).capabilities?.pushNotifications
      )
    )
      return rpcError(
        id,
        request.method.includes("PushNotification") ? -32003 : -32004,
        "Operation not supported",
      );
    if (
      !A2A_PROFILE.methods.includes(request.method as never) &&
      !A2A_PROFILE.unsupportedMethods.includes(request.method as never) &&
      !A2A_PROFILE.optInPushMethods.includes(request.method as never)
    )
      return rpcError(id, -32601, "Method not found");
    if (!object(request.params)) return rpcError(id, -32602, "Invalid params");
    const params = request.params;
    if (request.method.includes("PushNotification")) {
      if (
        typeof params.taskId !== "string" ||
        !params.taskId ||
        params.taskId.length > 128
      )
        return rpcError(id, -32602, "Invalid push task ID");
      if (
        params.id !== undefined &&
        (typeof params.id !== "string" || params.id.length > 128)
      )
        return rpcError(id, -32602, "Invalid push config ID");
      if (
        params.pageSize !== undefined &&
        (!Number.isInteger(params.pageSize) || Number(params.pageSize) < 0)
      )
        return rpcError(id, -32602, "Invalid push page size");
      if (
        request.method === "CreateTaskPushNotificationConfig" &&
        (typeof params.url !== "string" ||
          params.url.length > 2048 ||
          !object(params.authentication) ||
          typeof params.authentication.scheme !== "string" ||
          typeof params.authentication.credentials !== "string")
      )
        return rpcError(id, -32602, "Invalid callback authentication");
    }
    // Tenant and caller identity come from the authenticated adapter, never wire data.
    if ("tenant" in params)
      return rpcError(id, -32602, "Wire tenant is not accepted");
    if (
      request.method === "SendMessage" ||
      request.method === "SendStreamingMessage"
    ) {
      const msg = params.message;
      if (
        !object(msg) ||
        typeof msg.messageId !== "string" ||
        !msg.messageId.trim() ||
        msg.role !== "ROLE_USER" ||
        !Array.isArray(msg.parts) ||
        !msg.parts.length
      )
        return rpcError(id, -32602, "Invalid message");
      if (
        msg.messageId.length > 128 ||
        ["contextId", "taskId"].some(
          (key) =>
            msg[key] !== undefined &&
            (typeof msg[key] !== "string" || String(msg[key]).length > 128),
        )
      )
        return rpcError(id, -32602, "Invalid message identity");
      try {
        validateParts(msg.parts);
      } catch {
        return rpcError(id, -32005, "Unsupported or invalid content parts");
      }
      if (params.configuration !== undefined) {
        if (!object(params.configuration))
          return rpcError(id, -32602, "Invalid configuration");
        const config = params.configuration;
        if (
          config.returnImmediately !== undefined &&
          typeof config.returnImmediately !== "boolean"
        )
          return rpcError(id, -32602, "Invalid returnImmediately");
        if (
          config.historyLength !== undefined &&
          (!Number.isInteger(config.historyLength) ||
            Number(config.historyLength) < 0)
        )
          return rpcError(id, -32602, "Invalid historyLength");
        if (config.taskPushNotificationConfig !== undefined) {
          if (!(await handler.getAgentCard()).capabilities?.pushNotifications)
            return rpcError(id, -32003, "Push notifications not supported");
          const push = config.taskPushNotificationConfig;
          if (
            !object(push) ||
            typeof push.url !== "string" ||
            !object(push.authentication) ||
            typeof push.authentication.scheme !== "string" ||
            typeof push.authentication.credentials !== "string"
          )
            return rpcError(id, -32602, "Invalid push configuration");
        }
      }
    }
    if (
      params.historyLength !== undefined &&
      (!Number.isSafeInteger(params.historyLength) ||
        Number(params.historyLength) < 0)
    )
      return rpcError(id, -32602, "Invalid historyLength");
    if (
      ["GetTask", "CancelTask", "SubscribeToTask"].includes(request.method) &&
      (typeof params.id !== "string" || !params.id || params.id.length > 128)
    )
      return rpcError(id, -32602, "Invalid task ID");
    if (request.method === "ListTasks") {
      if (
        params.pageSize !== undefined &&
        (!Number.isInteger(params.pageSize) ||
          Number(params.pageSize) < 1 ||
          Number(params.pageSize) > 100)
      )
        return rpcError(id, -32602, "Invalid pageSize");
      if (
        params.pageToken !== undefined &&
        (typeof params.pageToken !== "string" || params.pageToken.length > 4096)
      )
        return rpcError(id, -32602, "Invalid pageToken");
      if (
        params.includeArtifacts !== undefined &&
        typeof params.includeArtifacts !== "boolean"
      )
        return rpcError(id, -32602, "Invalid includeArtifacts");
    }
    const result = await rpc.handle(
      request,
      new ServerCallContext({
        user: context.user,
        tenant: context.tenant,
        requestedVersion: A2A_PROFILE.wireVersion,
        requestedExtensions: context.requestedExtensions,
        state: context.state,
      }),
    );
    const publicEnvelope = (value: typeof result | unknown): unknown => {
      const envelope = value as any;
      if (envelope?.error?.code === -32603)
        return {
          jsonrpc: "2.0",
          id: envelope.id ?? id,
          error: { code: -32603, message: "Internal A2A request error." },
        };
      return value;
    };
    if (!("next" in result)) {
      const text = JSON.stringify(publicEnvelope(result));
      if (Buffer.byteLength(text) > A2A_PROFILE.maxResponseBytes)
        return rpcError(id, -32603, "Response limit exceeded");
      return new Response(text, {
        headers: { "Content-Type": "application/json" },
      });
    }
    const iterator = result[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    let total = 0;
    let ended = false;
    const closeIterator = async () => {
      if (ended) return;
      ended = true;
      await iterator.return?.();
    };
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            signal.throwIfAborted();
            const next = await iterator.next();
            if (ended) return;
            if (next.done) {
              ended = true;
              controller.close();
              return;
            }
            const data = encoder.encode(
              "data: " + JSON.stringify(publicEnvelope(next.value)) + "\n\n",
            );
            total += data.byteLength;
            if (
              data.byteLength > A2A_PROFILE.maxStreamFrameBytes ||
              total > A2A_PROFILE.maxStreamBytes
            )
              throw new Error("Stream limit exceeded");
            controller.enqueue(data);
          } catch (error) {
            controller.error(error);
            await closeIterator();
          }
        },
        cancel: closeIterator,
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
