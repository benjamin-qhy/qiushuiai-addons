import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerService } from "./service.js";
import type { Peer } from "./state.js";
import { runAction } from "./index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "peer-policy-"));
  let reply: any = { inbox: true, modes: ["queue"], agents: [], files: false };
  let calls = 0;
  const service = new PeerService({
    dataDir: root,
    runtime: { messaging: { listAdvertisableAgents: async () => [] } } as any,
    transportFactory: () => ({
      id: "11".repeat(32), clientId: "local", start: async () => {}, close: async () => {}, status: () => ({ active: true }),
      request: async (_peer: string, op: string) => { expect(op).toBe("roster"); calls++; return { body: typeof reply === "function" ? await reply() : reply }; },
    }) as any,
  });
  service.state.saveConfig({ ...service.state.config(), enabled: true });
  const peer: Peer = { id: "22".repeat(32), alias: "lab", name: "Lab", status: "paired", request: "r", epoch: "e", expires: Date.now() + 60000, ticket: null, scope: "named-agents", agents: ["research"], modes: ["queue", "auto"], files: false, lastSeen: null };
  service.state.put(peer);
  return { service, peer, calls: () => calls, reply: (next: any) => { reply = next; }, close: async () => { await service.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("file-only policy preserves scope, agents and modes; rejected saves are atomic and per-peer", async () => {
  const f = fixture();
  const other = { ...f.peer, id: "33".repeat(32), alias: "other" };
  f.service.state.put(other);
  try {
    for (const patch of [{ files: true }, { modes: [] }, { scope: "invalid" }, { agents: ["INVALID"] }]) {
      expect(() => f.service.setPolicy(f.peer.id, { ...f.peer, ...patch })).toThrow();
      expect(f.service.state.peer(f.peer.id)).toEqual(f.peer);
    }
    f.service.setPolicy(f.peer.id, { ...f.peer, files: true, confirmation: "ALLOW REMOTE ACCESS" });
    expect(f.service.state.peer(f.peer.id)).toEqual({ ...f.peer, files: true });
    f.service.setPolicy(f.peer.id, { ...f.peer, files: false, confirmation: "ALLOW REMOTE ACCESS" });
    expect(f.service.state.peer(f.peer.id)).toEqual(f.peer);
    expect(f.service.state.peer(other.id)).toEqual(other);
    expect(f.calls()).toBe(0);
  } finally { await f.close(); }
});

test("remote permissions are explicit, read-only and distinct from local incoming grants", async () => {
  const f = fixture();
  try {
    await f.service.dashboard();
    expect(f.calls()).toBe(0);
    const result = await runAction({ action: "remote_permissions", peer: f.peer.id }, f.service);
    expect(result).toMatchObject({ peerId: f.peer.id, inbox: true, modes: ["queue"], agents: [], files: false, limits: { maxFiles: 4, maxFileBytes: 16777216, maxTotalBytes: 33554432 } });
    expect(f.calls()).toBe(1);
    expect(f.service.state.peer(f.peer.id)).toEqual(f.peer);
    f.reply({ inbox: true, modes: ["queue"], agents: [{ name: "example", modes: [] }], files: true });
    expect((await f.service.remotePermissions("lab")).agents[0].modes).toEqual([]);
    f.reply({ inbox: true, modes: ["execute"], agents: [], files: true });
    await expect(f.service.remotePermissions("lab")).rejects.toThrow();
    f.reply({ inbox: true, modes: ["queue"], agents: [], files: "yes" });
    await expect(f.service.remotePermissions("lab")).rejects.toThrow();
  } finally { await f.close(); }
});

test("atomic policy compare rejects concurrent narrowing and re-pairing without overwriting restrictions", async () => {
  const f = fixture();
  const expected_policy = { scope: f.peer.scope, modes: f.peer.modes, agents: f.peer.agents, files: f.peer.files };
  const request = { ...expected_policy, files: true, confirmation: "ALLOW REMOTE ACCESS", expected_policy, expected_epoch: f.peer.epoch };
  try {
    const narrowed = { ...f.peer, scope: "inbox-only" as const, modes: ["queue" as const], agents: [] };
    f.service.state.put(narrowed);
    expect(() => f.service.setPolicy(f.peer.id, request)).toThrow("changed");
    expect(f.service.state.peer(f.peer.id)).toEqual(narrowed);
    const repaired = { ...f.peer, epoch: "new-pairing" };
    f.service.state.put(repaired);
    expect(() => f.service.setPolicy(f.peer.id, request)).toThrow("changed");
    expect(f.service.state.peer(f.peer.id)).toEqual(repaired);
    f.service.state.put(f.peer);
    f.service.setPolicy(f.peer.id, request);
    expect(f.service.state.peer(f.peer.id)).toEqual({ ...f.peer, files: true });
    expect(() => f.service.setPolicy(f.peer.id, request)).toThrow("changed");
    expect(f.service.state.peer(f.peer.id)?.files).toBe(true);
  } finally { await f.close(); }
});

test("remote refresh rejects revocation, epoch replacement and disable during the request", async () => {
  for (const change of ["revoked", "epoch", "disabled"]) {
    const f = fixture();
    f.reply(() => {
      if (change === "disabled") f.service.state.saveConfig({ ...f.service.state.config(), enabled: false });
      else f.service.state.put({ ...f.peer, ...(change === "epoch" ? { epoch: "new" } : { status: "revoked" as const }) });
      return { inbox: true, modes: ["queue"], agents: [], files: true };
    });
    try { await expect(f.service.remotePermissions("lab")).rejects.toThrow(); }
    finally { await f.close(); }
  }
});
