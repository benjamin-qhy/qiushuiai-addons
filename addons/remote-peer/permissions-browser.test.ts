import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { settingsBrowserEnabled, settingsPaneFixture } from "../../scripts/lib/settings-pane-browser.js";
const browserTest = settingsBrowserEnabled ? test : test.skip;
let fixture: Awaited<ReturnType<typeof settingsPaneFixture>>;
beforeAll(async () => { if (settingsBrowserEnabled) fixture = await settingsPaneFixture(new URL("./web/index.ts", import.meta.url).pathname, { realHost: true }); }, 30000);
afterAll(async () => { await fixture?.close(); });

async function setup(skin: string, width: number) {
  const f = await fixture.page(skin, width);
  const peer = (id: string, alias: string) => ({ id, alias, name: alias, clientId: "PCL1-" + id, status: "paired", epoch: "epoch", scope: "named-agents", agents: ["research", "hidden"], modes: ["queue", "auto"], files: false });
  const data = { config: { enabled: true, instanceName: "Test", relays: [], relayMode: "disabled", mdnsEnabled: false, addressLookup: false }, identity: { clientId: "PCL1-local" }, transport: { active: true }, discovery: { active: false }, peers: [peer("first", "Lab"), peer("second", "Other")], advertised: [{ alias: "research", local_agent: "research" }], candidates: [], messages: [], work: [], localAgents: [] };
  const writes: any[] = [];
  const failure = { post: false, get: false, remote: false, hold: null as null | Promise<void>, remoteCalls: 0, beforeWrite: null as null | (() => void) };
  await f.page.route("**/agent/addons/api/remote-peer/dashboard", async (route: any) => {
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.action === "remote_permissions") {
      failure.remoteCalls++;
      if (failure.remote) return route.fulfill({ status: 503, json: { error: "Peer offline" } });
      return route.fulfill({ json: { ...data, result: { peerId: body.peer, fetchedAt: new Date().toISOString(), inbox: true, agents: [], modes: ["queue"], files: false, limits: { maxFiles: 4, maxFileBytes: 16777216, maxTotalBytes: 33554432 } } } });
    }
    if (body) {
      writes.push(body);
      if (failure.hold) await failure.hold;
      if (failure.post) return route.fulfill({ status: 400, json: { error: "Permission write rejected" } });
      expect(body.action).toBe("policy");
      expect(body.confirmation).toBe("ALLOW REMOTE ACCESS");
      failure.beforeWrite?.();
      const p = data.peers.find(p => p.id === body.peer)!;
      const policy = (p: any) => JSON.stringify([p.scope, p.modes, p.agents, p.files]);
      if (p.epoch !== body.expected_epoch || policy(p) !== policy(body.expected_policy))
        return route.fulfill({ status: 409, json: { error: "Saved permissions or pairing changed. Revert to reload before applying." } });
      Object.assign(p, { scope: body.scope, modes: body.modes, agents: body.agents, files: body.files });
    } else if (failure.get) return route.fulfill({ status: 503, json: { error: "Readback failed" } });
    return route.fulfill({ json: data });
  });
  await f.page.goto(f.url);
  const card = f.page.locator('[data-peer-id="first"]');
  await card.getByRole("button", { name: "Edit incoming permissions" }).waitFor();
  return { ...f, card, data, writes, failure };
}

for (const skin of ["classic", "visual", "legacy"]) for (const width of [1366, 820, 520, 390]) {
  browserTest(`Remote Peer ${skin}/${width} incoming file-only Apply/Cancel/Revert and outgoing ownership`, async () => {
    const f = await setup(skin, width), { page, card } = f;
    try {
      expect(f.failure.remoteCalls).toBe(0);
      // Every text/select/multiline field opts into the host's same-skin shell.
      for (const label of ["Instance name", "Peer client ID", "Peer alias", "IPv4 interface (optional)", "Advertise a local agent", "Relay mode", "Custom relays (JSON)"]) {
        const field = page.getByLabel(label, { exact: true });
        expect(await field.getAttribute("class")).toContain("settings-addon-control");
        const geometry = await field.evaluate((el: HTMLElement) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect(), parent = el.parentElement!.getBoundingClientRect();
          return { radius: s.borderRadius, padding: s.padding, border: s.borderTopWidth, fits: r.right <= parent.right + 1 && r.left >= parent.left - 1 };
        });
        expect(geometry).toEqual({ radius: skin === "visual" ? "3px" : "6px", padding: skin === "visual" ? "5px 10px" : "6px 10px", border: "1px", fits: true });
      }
      expect(await page.locator(".remote-peer-settings").evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await card.getByRole("button", { name: "Edit incoming permissions" }).click();
      const files = card.getByRole("checkbox", { name: "Allow this peer to send files here" });
      await card.getByRole("checkbox", { name: "queue", exact: true }).uncheck();
      await card.getByRole("checkbox", { name: "auto", exact: true }).uncheck();
      expect(await card.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
      await card.getByRole("button", { name: "Revert", exact: true }).click();
      await files.check();
      expect(await card.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
      await card.getByLabel("Confirm wider incoming access").fill("WRONG");
      expect(await card.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
      await card.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(f.writes).toEqual([]);
      await card.getByRole("button", { name: "Edit incoming permissions" }).click();
      expect(await files.isChecked()).toBe(false);
      await files.check();
      await card.getByRole("button", { name: "Revert", exact: true }).click();
      expect(await files.isChecked()).toBe(false);
      await files.check();
      await card.getByLabel("Confirm wider incoming access").fill("ALLOW REMOTE ACCESS");
      expect(await card.locator(".remote-peer-permissions").evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const evidence = process.env.PICLAW_REMOTE_PEER_SCREENSHOT_DIR;
      if (evidence && skin !== "legacy" && [1366, 390].includes(width)) {
        if (!isAbsolute(evidence)) throw Error("Screenshot output must be an explicit absolute directory");
        mkdirSync(evidence, { recursive: true });
        await card.locator(".remote-peer-permissions").screenshot({ path: join(evidence, `permissions-${skin}-${width}.png`) });
      }
      await card.getByRole("button", { name: "Apply", exact: true }).click();
      await card.getByText(/Incoming permissions saved and reloaded/).waitFor();
      expect(f.writes).toEqual([{ action: "policy", peer: "first", scope: "named-agents", modes: ["queue", "auto"], agents: ["research", "hidden"], files: true, confirmation: "ALLOW REMOTE ACCESS", expected_epoch: "epoch", expected_policy: { scope: "named-agents", modes: ["queue", "auto"], agents: ["research", "hidden"], files: false } }]);
      expect(f.data.peers[1].files).toBe(false);
      await page.reload();
      await card.getByText(/Saved: named-agents · queue, auto · incoming files enabled/).waitFor();
      await card.getByRole("button", { name: "Refresh remote permissions" }).click();
      await card.getByText(/outgoing files disabled/).waitFor();
      expect(f.data.peers[0].files).toBe(true);
      f.failure.remote = true;
      await card.getByRole("button", { name: "Refresh remote permissions" }).click();
      await card.getByRole("alert").filter({ hasText: "Peer offline" }).waitFor();
      expect(await card.getByText(/Last fetched snapshot is stale/).isVisible()).toBe(true);
      const outgoing = card.getByRole("region", { name: "Outgoing permissions", exact: true });
      expect(await outgoing.locator("input,select,textarea").count()).toBe(0);
      await card.getByRole("button", { name: "Edit incoming permissions" }).click();
      await files.uncheck();
      await card.getByLabel("Confirm wider incoming access").fill("ALLOW REMOTE ACCESS");
      await card.getByRole("button", { name: "Apply", exact: true }).click();
      await card.getByText(/Incoming permissions saved and reloaded/).waitFor();
      expect(f.writes[1]).toEqual({ ...f.writes[0], files: false, expected_policy: { ...f.writes[0].expected_policy, files: true } });
      expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
}

browserTest("Remote Peer preserves edits on server error, disables double Apply and verifies readback", async () => {
  const f = await setup("classic", 1100), { page, card } = f;
  try {
    await card.getByRole("button", { name: "Edit incoming permissions" }).click();
    const files = card.getByRole("checkbox", { name: "Allow this peer to send files here" });
    await files.check();
    await card.getByLabel("Confirm wider incoming access").fill("ALLOW REMOTE ACCESS");
    f.failure.post = true;
    let release!: () => void;
    f.failure.hold = new Promise<void>(resolve => { release = resolve; });
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await card.getByText("Applying incoming permissions…", { exact: true }).waitFor();
    expect(await card.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
    release();
    await card.getByRole("alert").filter({ hasText: "Permission write rejected" }).waitFor();
    expect(await files.isChecked()).toBe(true);
    expect(f.writes).toHaveLength(1);
    expect(f.data.peers[0].files).toBe(false);
    f.failure.post = false; f.failure.hold = null; f.failure.get = true;
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "Readback failed" }).waitFor();
    expect(await card.getByText(/Incoming permissions saved and reloaded/).count()).toBe(0);
    expect(await files.isChecked()).toBe(true);
    f.failure.get = false;
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "Saved permissions or pairing changed" }).waitFor();
    expect(await files.isChecked()).toBe(true);
    expect(f.data.peers[0].files).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await page.close(); }
}, 20000);

browserTest("dashboard polling preserves unsaved edits and reports saved-policy conflicts", async () => {
  const f = await setup("classic", 1100), { page, card } = f;
  try {
    await card.getByRole("button", { name: "Edit incoming permissions" }).click();
    const files = card.getByRole("checkbox", { name: "Allow this peer to send files here" });
    await files.check();
    await card.getByLabel("Confirm wider incoming access").fill("ALLOW REMOTE ACCESS");
    f.data.peers[0].modes = ["queue"];
    await card.getByRole("alert").filter({ hasText: "Saved permissions changed while you were editing" }).waitFor({ timeout: 8000 });
    expect(await files.isChecked()).toBe(true);
    expect(await card.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
    expect(f.writes).toEqual([]);
    await card.getByRole("button", { name: "Revert", exact: true }).click();
    expect(await files.isChecked()).toBe(false);
    expect(await card.getByRole("checkbox", { name: "auto", exact: true }).isChecked()).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);

for (const race of ["narrow", "re-pair"]) browserTest(`Apply rejects ${race} between poll and write without losing draft`, async () => {
  const f = await setup("classic", 1100), { page, card } = f;
  try {
    await card.getByRole("button", { name: "Edit incoming permissions" }).click();
    const files = card.getByRole("checkbox", { name: "Allow this peer to send files here" });
    await files.check();
    await card.getByLabel("Confirm wider incoming access").fill("ALLOW REMOTE ACCESS");
    f.failure.beforeWrite = () => {
      if (race === "narrow") Object.assign(f.data.peers[0], { scope: "inbox-only", modes: ["queue"], agents: [] });
      else f.data.peers[0].epoch = "new-pair";
    };
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "Saved permissions or pairing changed" }).waitFor();
    expect(f.data.peers[0].files).toBe(false);
    expect(await files.isChecked()).toBe(true);
    expect(await card.getByText(/Incoming permissions saved and reloaded/).count()).toBe(0);
    if (race === "narrow") expect(f.data.peers[0].scope).toBe("inbox-only");
    expect(f.errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);
