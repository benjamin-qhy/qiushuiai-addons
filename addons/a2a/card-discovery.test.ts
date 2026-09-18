import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK } from "jose";
import { A2aOutboundClient } from "./client.js";
import { A2aClientStore } from "./client-store.js";
import { signCard } from "./card-security.js";
import type { A2aConfig } from "./config.js";

test("configured well-known endpoint verifies signed wire card, revalidates 304 and rejects changed policy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "a2a-discovery-")),
    store = new A2aClientStore(dir);
  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const keyData: Record<string, string> = {
    private: JSON.stringify(await exportJWK(keys.privateKey)),
    public: JSON.stringify(await exportJWK(keys.publicKey)),
    bearer: "disposable-card-peer-credential",
  };
  const secret = async (name: string) => keyData[name] ?? null;
  let gets = 0,
    conditional = 0;
  let corrupt = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      expect(new URL(req.url).pathname).toBe("/.well-known/agent-card.json");
      gets++;
      if (req.headers.get("authorization") !== "Bearer " + keyData.bearer)
        return new Response("no", { status: 401 });
      if (req.headers.get("if-none-match") === '"card1"' && !corrupt) {
        conditional++;
        return new Response(null, {
          status: 304,
          headers: { ETag: '"card1"', "Cache-Control": "private, no-cache" },
        });
      }
      const card = await signCard(
        {
          name: "fixture",
          description: "",
          version: "1",
          supportedInterfaces: [
            {
              url: new URL("/rpc", server.url).href,
              protocolBinding: "JSONRPC",
              protocolVersion: "1.0",
            },
          ],
          capabilities: { streaming: false },
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: [],
        },
        { kid: "k1", privateKeyRef: "private" },
        secret,
      );
      if (corrupt) card.name = "tampered";
      return Response.json(card, {
        headers: { ETag: '"card1"', "Cache-Control": "private, no-cache" },
      });
    },
  });
  const config: A2aConfig = {
    enabled: true,
    inbound: false,
    outbound: true,
    publicBaseUrl: "",
    agents: [],
    principals: [],
    endpoints: [
      {
        alias: "peer",
        cardUrl: new URL("/.well-known/agent-card.json", server.url).href,
        enabled: true,
        allowPrivate: true,
        credentialKey: "bearer",
        cardCacheMaxAgeSeconds: 60,
        cardVerification: {
          keys: [
            {
              kid: "k1",
              publicKeyRef: "public",
              notBefore: "2020-01-01",
              expiresAt: "2099-01-01",
            },
          ],
        },
      },
    ],
  };
  const client = new A2aOutboundClient(() => config, store, secret);
  try {
    const first = (await client.discover({
      scope: "work",
      endpoint: "peer",
    })) as any;
    expect(first.description).toBe("");
    expect(first.skills).toEqual([]);
    expect(first.signatures).toHaveLength(1);
    expect(await client.discover({ scope: "work", endpoint: "peer" })).toEqual(
      first,
    );
    expect(conditional).toBe(1);
    expect(gets).toBe(2);
    corrupt = true;
    await expect(
      client.discover({ scope: "work", endpoint: "peer" }),
    ).rejects.toThrow("No trusted");
    corrupt = false;
    config.endpoints[0].cardVerification!.keys[0].kid = "revoked";
    await expect(
      client.discover({ scope: "work", endpoint: "peer" }),
    ).rejects.toThrow("No trusted");
  } finally {
    await client.shutdown();
    store.close();
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
