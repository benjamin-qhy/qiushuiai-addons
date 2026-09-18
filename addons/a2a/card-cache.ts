import { createHash } from "node:crypto";
import { parseCardJson } from "./card-json.js";
import type { A2aEndpoint } from "./config.js";
import type { SecretResolver } from "./security.js";
import { verifyCard } from "./card-security.js";

type CachedCard = {
  raw: Record<string, unknown>;
  etag?: string;
  expires: number;
  maxAge: number;
};
function lifetime(
  headers: Headers,
  cap: number,
): { store: boolean; maxAge: number } {
  const directives = (headers.get("cache-control") || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  if (directives.includes("no-store")) return { store: false, maxAge: 0 };
  const ages = directives.filter((v) => v.startsWith("max-age="));
  const match = ages.length === 1 ? /^max-age="?(\d+)"?$/.exec(ages[0]) : null;
  const age = Number(headers.get("age") || "0");
  const raw =
    match && Number.isFinite(age) && age >= 0
      ? Math.max(0, Number(match[1]) - age)
      : 0;
  return {
    store: cap > 0,
    maxAge: directives.includes("no-cache") ? 0 : Math.min(cap, raw) * 1000,
  };
}
async function body(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Agent Card body missing");
  let count = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.byteLength;
      if (count > 128 * 1024) {
        await reader.cancel();
        throw new Error("Agent Card size limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const raw = parseCardJson(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  ) as Record<string, unknown>;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(raw.supportedInterfaces) ||
    raw.supportedInterfaces.length > 16 ||
    !Array.isArray(raw.skills) ||
    raw.skills.length > 128
  )
    throw new Error("Invalid Agent Card");
  return raw;
}
/** Per-client/work cache; cleared on config change/shutdown, never shared across credentials. */
export class AgentCardCache {
  private entries = new Map<string, CachedCard>();
  clear() {
    this.entries.clear();
  }
  async get(
    endpoint: A2aEndpoint,
    scope: string,
    fetcher: typeof fetch,
    secrets: SecretResolver,
    signal?: AbortSignal,
    now = Date.now(),
  ): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const credential = endpoint.credentialKey
      ? await secrets(endpoint.credentialKey)
      : null;
    if (endpoint.credentialKey && !credential)
      throw new Error("Agent Card credential unavailable");
    const key = createHash("sha256")
      .update(JSON.stringify([scope, endpoint, credential]))
      .digest("hex");
    const cap = endpoint.cardCacheMaxAgeSeconds ?? 0;
    let entry = cap > 0 ? this.entries.get(key) : undefined;
    if (entry && entry.expires > now) {
      if (endpoint.cardVerification)
        await verifyCard(entry.raw, endpoint.cardVerification, secrets, now);
      signal?.throwIfAborted();
      return structuredClone(entry.raw);
    }
    const headers = new Headers({ "A2A-Version": "1.0" });
    if (entry?.etag) headers.set("If-None-Match", entry.etag);
    let response: Response;
    try {
      response = await fetcher(endpoint.cardUrl, { signal, headers });
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
    try {
      signal?.throwIfAborted();
      let raw: Record<string, unknown>;
      if (response.status === 304) {
        if (!entry?.etag) throw new Error("Unsolicited Agent Card 304");
        if (
          response.headers.has("etag") &&
          response.headers.get("etag") !== entry.etag
        )
          throw new Error("Changed ETag on 304");
        raw = entry.raw;
      } else {
        if (!response.ok)
          throw new Error(`Agent Card request failed (${response.status}).`);
        raw = await body(response);
      }
      if (endpoint.cardVerification)
        await verifyCard(raw, endpoint.cardVerification, secrets, now);
      if (
        endpoint.credentialKey &&
        (await secrets(endpoint.credentialKey)) !== credential
      )
        throw new Error("Agent Card credential changed during fetch");
      const life = lifetime(response.headers, cap),
        etag =
          response.headers.get("etag") ??
          (response.status === 304 ? entry?.etag : undefined);
      if (life.store) {
        if (this.entries.size >= 64 && !this.entries.has(key))
          this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, {
          raw: structuredClone(raw),
          etag: etag && etag.length <= 256 ? etag : undefined,
          expires: now + life.maxAge,
          maxAge: life.maxAge,
        });
      } else this.entries.delete(key);
      signal?.throwIfAborted();
      return structuredClone(raw);
    } catch (error) {
      this.entries.delete(key);
      await response.body?.cancel().catch(() => false);
      throw error;
    }
  }
}
