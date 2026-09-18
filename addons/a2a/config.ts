import type { CardSigning, CardVerification } from "./card-security.js";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

export interface A2aPrincipal {
  id: string;
  credentialKey: string;
  targets: string[];
  enabled: boolean;
}
export interface A2aEndpoint {
  alias: string;
  cardUrl: string;
  credentialKey?: string;
  allowPrivate: boolean;
  cardCacheMaxAgeSeconds?: number;
  cardVerification?: CardVerification;
  enabled: boolean;
}
export interface A2aPublishedAgent {
  cardSigning?: CardSigning;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}
export interface A2aConfig {
  enabled: boolean;
  inbound: boolean;
  outbound: boolean;
  publicBaseUrl: string;
  principals: A2aPrincipal[];
  endpoints: A2aEndpoint[];
  agents: A2aPublishedAgent[];
}
export const EMPTY_CONFIG: A2aConfig = {
  enabled: false,
  inbound: false,
  outbound: false,
  publicBaseUrl: "",
  principals: [],
  endpoints: [],
  agents: [],
};
export function opaqueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(value))
    throw new Error("Invalid A2A identifier.");
  return value;
}
function record(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error("Unknown or invalid A2A configuration field.");
  return v as Record<string, unknown>;
}
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") throw new Error("Boolean setting required.");
  return v;
}
function text(v: unknown, max = 256): string {
  if (typeof v !== "string" || v.length > max || /[\r\n\0]/.test(v))
    throw new Error("Invalid bounded setting text.");
  return v;
}
function key(v: unknown): string {
  const s = text(v);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/.test(s))
    throw new Error("Keychain entry name required.");
  return s;
}
function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length > 64)
    throw new Error("Configuration list exceeds limit.");
  return v;
}
function unique<T>(items: T[], id: (item: T) => string): T[] {
  if (new Set(items.map(id)).size !== items.length)
    throw new Error("Duplicate A2A identifier.");
  return items;
}
export function endpointUrl(value: string, allowPrivate = false): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search)
    throw new Error(
      "Credentials, fragments and queries are not permitted in configured URLs.",
    );
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:"))
    throw new Error("HTTPS required.");
  return url;
}
export function validateConfig(value: unknown): A2aConfig {
  const r = record(value, [
    "enabled",
    "inbound",
    "outbound",
    "publicBaseUrl",
    "principals",
    "endpoints",
    "agents",
  ]);
  const principals = unique(
    list(r.principals).map((v) => {
      const p = record(v, ["id", "credentialKey", "targets", "enabled"]);
      return {
        id: opaqueId(p.id),
        credentialKey: key(p.credentialKey),
        targets: unique(list(p.targets).map(opaqueId), (s) => s),
        enabled: bool(p.enabled),
      };
    }),
    (p) => p.id,
  );
  // Sharing a credential between principals creates ambiguous authentication and is forbidden.
  unique(principals, (p) => p.credentialKey);
  const endpoints = unique(
    list(r.endpoints).map((v) => {
      const p = record(v, [
        "alias",
        "cardUrl",
        "credentialKey",
        "allowPrivate",
        "cardCacheMaxAgeSeconds",
        "cardVerification",
        "enabled",
      ]);
      const allowPrivate = bool(p.allowPrivate),
        cardUrl = text(p.cardUrl, 2048);
      endpointUrl(cardUrl, allowPrivate);
      return {
        alias: opaqueId(p.alias),
        cardUrl,
        ...(p.credentialKey ? { credentialKey: key(p.credentialKey) } : {}),
        allowPrivate,
        ...(p.cardCacheMaxAgeSeconds === undefined
          ? {}
          : { cardCacheMaxAgeSeconds: cacheSeconds(p.cardCacheMaxAgeSeconds) }),
        ...(p.cardVerification === undefined
          ? {}
          : { cardVerification: verification(p.cardVerification) }),
        enabled: bool(p.enabled),
      };
    }),
    (p) => p.alias,
  );
  const agents = unique(
    list(r.agents).map((v) => {
      const p = record(v, [
        "id",
        "name",
        "description",
        "enabled",
        "cardSigning",
      ]);
      return {
        ...(p.cardSigning === undefined
          ? {}
          : { cardSigning: signing(p.cardSigning) }),
        id: opaqueId(p.id),
        name: text(p.name),
        description: text(p.description, 1024),
        enabled: bool(p.enabled),
      };
    }),
    (p) => p.id,
  );
  if (
    principals.some((p) =>
      p.targets.some((t) => !agents.some((a) => a.id === t)),
    )
  )
    throw new Error("Principal references an unpublished target.");
  const publicBaseUrl = text(r.publicBaseUrl, 2048);
  if (publicBaseUrl) endpointUrl(publicBaseUrl, false);
  const config = {
    enabled: bool(r.enabled),
    inbound: bool(r.inbound),
    outbound: bool(r.outbound),
    publicBaseUrl,
    principals,
    endpoints,
    agents,
  };
  if (
    config.enabled &&
    config.inbound &&
    (!publicBaseUrl ||
      !principals.some((p) => p.enabled) ||
      !agents.some((a) => a.enabled))
  )
    throw new Error(
      "Inbound A2A requires HTTPS base URL, principal and published agent.",
    );
  return config;
}
export class A2aConfigStore {
  constructor(private readonly directory: string) {}
  read(): A2aConfig {
    const path = join(this.directory, "config.json");
    return existsSync(path)
      ? validateConfig(JSON.parse(readFileSync(path, "utf8")))
      : structuredClone(EMPTY_CONFIG);
  }
  write(value: unknown): A2aConfig {
    const config = validateConfig(value);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "config.json"),
      tmp = path + "." + crypto.randomUUID();
    writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
    return config;
  }
}

function cacheSeconds(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 300)
    throw new Error("Card cache limit must be 0..300 seconds.");
  return Number(value);
}
function signing(value: unknown): CardSigning {
  const v = record(value, ["kid", "privateKeyRef"]);
  return { kid: opaqueId(v.kid), privateKeyRef: key(v.privateKeyRef) };
}
function verification(value: unknown): CardVerification {
  const v = record(value, ["keys"]);
  const keys = list(v.keys);
  if (keys.length < 1 || keys.length > 8)
    throw new Error("One to eight card trust keys required.");
  return {
    keys: unique(
      keys.map((item) => {
        const r = record(item, [
          "kid",
          "publicKeyRef",
          "notBefore",
          "expiresAt",
        ]);
        const notBefore = text(r.notBefore),
          expiresAt = text(r.expiresAt);
        if (
          !Number.isFinite(Date.parse(notBefore)) ||
          !Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(notBefore) >= Date.parse(expiresAt)
        )
          throw new Error("Invalid card trust key validity window.");
        return {
          kid: opaqueId(r.kid),
          publicKeyRef: key(r.publicKeyRef),
          notBefore,
          expiresAt,
        };
      }),
      (k) => k.kid,
    ),
  };
}
