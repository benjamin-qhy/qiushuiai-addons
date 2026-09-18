import { FlattenedSign, flattenedVerify, importJWK, type JWK } from "jose";
import fields from "./protocol/card-fields.json";
import { parseCardJson } from "./card-json.js";
import type { SecretResolver } from "./security.js";

export interface CardTrustKey {
  kid: string;
  publicKeyRef: string;
  notBefore: string;
  expiresAt: string;
}
export interface CardVerification {
  keys: CardTrustKey[];
}
export interface CardSigning {
  kid: string;
  privateKeyRef: string;
}
type Rule = {
  type: string;
  required?: boolean;
  presence?: boolean;
  repeated?: boolean;
  map?: boolean;
};
const definitions = fields as Record<string, Record<string, Rule>>;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validUnicode(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error("Invalid Unicode in Agent Card");
    } else if (c >= 0xdc00 && c <= 0xdfff)
      throw new Error("Invalid Unicode in Agent Card");
  }
}
/** RFC8785 property order (UTF16), ECMAScript numbers, no lone surrogates/NaN. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 40) throw new Error("Agent Card nesting limit");
  if (value === null) return "null";
  if (typeof value === "string") {
    validUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid JSON number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return "[" + value.map((v) => canonicalJson(v, depth + 1)).join(",") + "]";
  if (object(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => canonicalJson(k) + ":" + canonicalJson(value[k], depth + 1))
        .join(",") +
      "}"
    );
  throw new Error("Invalid JSON value in Agent Card");
}
function defaultValue(rule: Rule): unknown {
  return rule.repeated
    ? []
    : rule.map || definitions[rule.type]
      ? {}
      : rule.type === "bool"
        ? false
        : rule.type === "string"
          ? ""
          : 0;
}
function empty(value: unknown) {
  return (
    value === "" ||
    value === false ||
    value === 0 ||
    value === null ||
    (Array.isArray(value) && value.length === 0) ||
    (object(value) && Object.keys(value).length === 0)
  );
}
function scalar(
  value: unknown,
  type: string,
  depth: number,
  reconstruct: boolean,
): unknown {
  if (definitions[type])
    return normalizeMessage(value, type, depth + 1, reconstruct);
  if (type === "google.protobuf.Struct") {
    if (!object(value)) throw new Error("Invalid card Struct");
    canonicalJson(value);
    return structuredClone(value);
  }
  if (type === "string") {
    if (typeof value !== "string") throw new Error("Invalid card string");
    validUnicode(value);
    return value;
  }
  if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("Invalid card boolean");
    return value;
  }
  throw new Error("Unrecognised pinned Agent Card field type");
}
function normalizeMessage(
  value: unknown,
  type: string,
  depth = 0,
  reconstruct = false,
): Record<string, unknown> {
  if (depth > 24 || !object(value))
    throw new Error("Invalid Agent Card object");
  const schema = definitions[type],
    out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value))
    if (!Object.hasOwn(schema, key))
      throw new Error("Unknown signed Agent Card field");
  for (const [key, rule] of Object.entries(schema)) {
    if (type === "AgentCard" && key === "signatures") continue;
    let raw = value[key];
    if (raw === undefined || raw === null) {
      if (!rule.required) continue;
      if (!reconstruct || raw === null)
        throw new Error(`Missing required Agent Card field: ${type}.${key}`);
      raw = defaultValue(rule);
    }
    let normalized: unknown;
    if (rule.repeated) {
      if (!Array.isArray(raw)) throw new Error("Invalid card repeated field");
      normalized = raw.map((v) => scalar(v, rule.type, depth, reconstruct));
    } else if (rule.map) {
      if (!object(raw)) throw new Error("Invalid card map");
      normalized = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [
          k,
          scalar(v, rule.type, depth, reconstruct),
        ]),
      );
    } else normalized = scalar(raw, rule.type, depth, reconstruct);
    if (rule.required || rule.presence || !empty(normalized))
      out[key] = normalized;
  }
  // Canonical card schema contains two security-related oneofs. Reject multiple values.
  if (
    ["SecurityScheme", "OAuthFlows"].includes(type) &&
    Object.keys(out).length > 1
  )
    throw new Error("Ambiguous card oneof");
  return out;
}
export function canonicalAgentCard(raw: unknown): string {
  return canonicalJson(normalizeMessage(raw, "AgentCard"));
}
function decodeHeader(encoded: unknown): {
  alg: string;
  kid: string;
  typ?: string;
} {
  if (
    typeof encoded !== "string" ||
    encoded.length > 2048 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  )
    throw new Error("Invalid protected header");
  const header = parseCardJson(
    new TextDecoder("utf8", { fatal: true }).decode(
      Buffer.from(encoded, "base64url"),
    ),
  );
  if (
    !object(header) ||
    header.alg !== "EdDSA" ||
    typeof header.kid !== "string" ||
    !header.kid ||
    header.kid.length > 128 ||
    (header.typ !== undefined && header.typ !== "JOSE") ||
    Object.keys(header).some((k) => !["alg", "kid", "typ"].includes(k))
  )
    throw new Error("Unsupported protected Agent Card header");
  return header as { alg: string; kid: string; typ?: string };
}
function jwk(value: string, privateKey: boolean): JWK {
  const key = JSON.parse(value);
  if (
    !object(key) ||
    key.kty !== "OKP" ||
    key.crv !== "Ed25519" ||
    typeof key.x !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
    (key.alg !== undefined && key.alg !== "EdDSA") ||
    (key.use !== undefined && key.use !== "sig") ||
    (privateKey && typeof key.d !== "string") ||
    (!privateKey && "d" in key)
  )
    throw new Error("Invalid pinned Ed25519 key");
  return key as JWK;
}
export async function verifyCard(
  raw: unknown,
  policy: CardVerification,
  resolve: SecretResolver,
  now = Date.now(),
): Promise<void> {
  if (
    !object(raw) ||
    !Array.isArray(raw.signatures) ||
    !raw.signatures.length ||
    raw.signatures.length > 8
  )
    throw new Error("Required Agent Card signature missing or oversized");
  const payload = Buffer.from(canonicalAgentCard(raw)).toString("base64url");
  for (const signature of raw.signatures) {
    if (
      !object(signature) ||
      typeof signature.signature !== "string" ||
      signature.signature.length > 256
    )
      continue;
    let header;
    try {
      header = decodeHeader(signature.protected);
    } catch {
      continue;
    }
    const trusted = policy.keys.find(
      (k) =>
        k.kid === header.kid &&
        Date.parse(k.notBefore) <= now &&
        now < Date.parse(k.expiresAt),
    );
    if (!trusted) continue;
    // Never fetch jku/x5u/jwk supplied by the card; only operator-pinned local public key refs.
    const publicJson = await resolve(trusted.publicKeyRef);
    if (!publicJson) continue;
    try {
      const key = await importJWK(jwk(publicJson, false), "EdDSA");
      // Unprotected JOSE headers are not authority; forbid any for this conservative profile.
      if (
        signature.header &&
        (!object(signature.header) || Object.keys(signature.header).length)
      )
        continue;
      await flattenedVerify(
        {
          protected: signature.protected as string,
          payload,
          signature: signature.signature,
        },
        key,
        { algorithms: ["EdDSA"] },
      );
      return;
    } catch {
      continue;
    }
  }
  throw new Error("No trusted unexpired Agent Card signature");
}
export async function signCard(
  raw: unknown,
  policy: CardSigning,
  resolve: SecretResolver,
): Promise<Record<string, unknown>> {
  const secret = await resolve(policy.privateKeyRef);
  if (!secret) throw new Error("Agent Card signing key unavailable");
  // Only locally generated SDK cards may need omitted defaults restored before
  // signing. Remote signed input is always presence-checked by canonicalAgentCard.
  const normalized = normalizeMessage(raw, "AgentCard", 0, true);
  const key = await importJWK(jwk(secret, true), "EdDSA");
  const signature = await new FlattenedSign(
    new TextEncoder().encode(canonicalJson(normalized)),
  )
    .setProtectedHeader({ alg: "EdDSA", kid: policy.kid, typ: "JOSE" })
    .sign(key);
  return {
    ...normalized,
    signatures: [
      { protected: signature.protected, signature: signature.signature },
    ],
  };
}
