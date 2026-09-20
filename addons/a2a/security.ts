import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { A2aConfig, A2aPrincipal, A2aEndpoint, endpointUrl } from "./config.js";

export type SecretResolver = (name: string) => Promise<string | null>;
/** Host keychain facade/injected references only; never spawn a CLI or search workspace source. */
export const resolveA2aSecret: SecretResolver = async (name) => {
  const runtime = (globalThis as any).__qiushuiaiRuntimeInterop;
  const entry = await runtime?.getKeychainEntry?.(name);
  const fromHost = typeof entry === "string" ? entry : entry?.secret;
  return (
    fromHost || process.env[name.replace(/[/.-]/g, "_").toUpperCase()] || null
  );
};
function equal(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export async function authenticateA2a(
  req: Request,
  config: A2aConfig,
  resolve: SecretResolver,
): Promise<A2aPrincipal | null> {
  if (!config.enabled || !config.inbound) return null;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length > 4096) return null;
  const supplied = auth.slice(7);
  if (supplied.length < 24) return null;
  const matches: A2aPrincipal[] = [];
  for (const principal of config.principals) {
    if (!principal.enabled) continue;
    const expected = await resolve(principal.credentialKey);
    if (expected && expected.length >= 24 && equal(supplied, expected))
      matches.push(principal);
  }
  return matches.length === 1 ? matches[0] : null;
}
export function authorizeTarget(
  config: A2aConfig,
  principalId: string,
  target: string,
): boolean {
  return (
    config.enabled &&
    config.inbound &&
    config.principals.some(
      (p) => p.id === principalId && p.enabled && p.targets.includes(target),
    ) &&
    config.agents.some((a) => a.id === target && a.enabled)
  );
}
function ipv4Public(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return ipv4Public(ip);
  if (isIP(ip) !== 6) return false;
  // Conservative IPv6 allowlist: global unicast 2000::/3, excluding documentation.
  return (
    /^[23][0-9a-f]{3}:/.test(ip) &&
    !ip.startsWith("2001:db8:") &&
    !ip.startsWith("2001:0:")
  );
}
export async function validateOutboundUrl(
  endpoint: A2aEndpoint,
  url: URL,
  lookupAddresses = async (host: string) =>
    (await lookup(host, { all: true, verbatim: true })).map((r) => r.address),
): Promise<void> {
  const card = endpointUrl(endpoint.cardUrl, endpoint.allowPrivate);
  if (
    url.origin !== card.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("A2A endpoint origin denied.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [hostname]
    : await lookupAddresses(hostname);
  if (!addresses.length || addresses.some((a) => !isIP(a)))
    throw new Error("A2A endpoint did not resolve safely.");
  if (!endpoint.allowPrivate && addresses.some((a) => !isPublicAddress(a)))
    throw new Error("A2A private endpoint denied.");
}
