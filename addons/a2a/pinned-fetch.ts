import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { A2aEndpoint } from "./config.js";
import { validateOutboundUrl, type SecretResolver } from "./security.js";

/** Resolve, validate, then pin the same address into the actual connection lookup.
 * TLS hostname verification still uses the configured hostname, not its IP.
 * No redirect following, cookie jar, proxy discovery or cross-origin credential reuse.
 */
export function pinnedEndpointFetch(
  endpoint: A2aEndpoint,
  resolveSecret: SecretResolver,
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
    await validateOutboundUrl(endpoint, url, async () =>
      addresses.map((a) => a.address),
    );
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("host");
    if (endpoint.credentialKey) {
      const secret = await resolveSecret(endpoint.credentialKey);
      if (!secret) throw new Error("A2A endpoint credential unavailable.");
      headers.set("authorization", "Bearer " + secret);
    }
    const signal =
      init.signal || (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const body =
      init.body ??
      (input instanceof Request ? await input.arrayBuffer() : undefined);
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== "string" &&
      !(body instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(body)
    )
      throw new Error("Unsupported A2A request body.");
    const data =
      body == null
        ? undefined
        : typeof body === "string"
          ? Buffer.from(body)
          : body instanceof ArrayBuffer
            ? Buffer.from(body)
            : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (data && data.byteLength > 64 * 1024)
      throw new Error("A2A outbound body limit.");
    return await new Promise<Response>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const selected = addresses[0];
      const req = send(
        url,
        {
          method:
            init.method || (input instanceof Request ? input.method : "GET"),
          headers: Object.fromEntries(headers),
          lookup: ((_host: string, options: any, callback: any) => {
            if (options?.all) callback(null, [selected]);
            else callback(null, selected.address, selected.family);
          }) as any,
          signal: signal ?? undefined,
          timeout: 30000,
        },
        (res) => {
          if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400) {
            res.destroy();
            reject(new Error("A2A redirects are not permitted."));
            return;
          }
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined)
              responseHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
          let bytes = 0;
          let ended = false;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              res.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 2 * 1024 * 1024) {
                  res.destroy(new Error("A2A response limit."));
                  return;
                }
                controller.enqueue(new Uint8Array(chunk));
                if ((controller.desiredSize ?? 0) <= 0) res.pause();
              });
              res.once("end", () => {
                ended = true;
                controller.close();
              });
              res.once("error", (error) => {
                if (!ended) {
                  ended = true;
                  controller.error(error);
                }
              });
              res.once("aborted", () => {
                if (!ended) {
                  ended = true;
                  controller.error(new Error("A2A response interrupted."));
                }
              });
            },
            pull() {
              res.resume();
            },
            cancel() {
              ended = true;
              res.destroy();
              req.destroy();
            },
          });
          if ([204, 205, 304].includes(res.statusCode || 0)) {
            res.resume();
            resolve(
              new Response(null, {
                status: res.statusCode,
                headers: responseHeaders,
              }),
            );
          } else
            resolve(
              new Response(stream, {
                status: res.statusCode || 502,
                headers: responseHeaders,
              }),
            );
        },
      );
      req.once("timeout", () =>
        req.destroy(new Error("A2A transport deadline.")),
      );
      req.once("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }) as typeof fetch;
}
