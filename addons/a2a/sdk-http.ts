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
async function boundedBody(req: Request): Promise<string> {
  const declared = req.headers.get("content-length");
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > A2A_PROFILE.maxRequestBytes)
  )
    throw new Error("body limit");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > A2A_PROFILE.maxRequestBytes) {
        await reader.cancel();
        throw new Error("body limit");
      }
      chunks.push(part.value);
    }
  } finally {
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
      body = await boundedBody(req);
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
    if (A2A_PROFILE.unsupportedMethods.includes(request.method as never))
      return rpcError(
        id,
        request.method.includes("PushNotification") ? -32003 : -32004,
        "Operation not supported",
      );
    if (!A2A_PROFILE.methods.includes(request.method as never))
      return rpcError(id, -32601, "Method not found");
    if (!object(request.params)) return rpcError(id, -32602, "Invalid params");
    const params = request.params;
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
      // A1 deliberately validates a text-only profile. Other typed parts land in A7.
      if (
        msg.parts.some(
          (p) =>
            !object(p) ||
            typeof p.text !== "string" ||
            ["raw", "url", "data", "file", "kind"].some((k) => k in p),
        )
      )
        return rpcError(id, -32005, "Unsupported content type");
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
        if (config.taskPushNotificationConfig !== undefined)
          return rpcError(id, -32003, "Push notifications not supported");
      }
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
    if (!("next" in result)) {
      const text = JSON.stringify(result);
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
            req.signal.throwIfAborted();
            const next = await iterator.next();
            if (ended) return;
            if (next.done) {
              ended = true;
              controller.close();
              return;
            }
            const data = encoder.encode(
              "data: " + JSON.stringify(next.value) + "\n\n",
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
