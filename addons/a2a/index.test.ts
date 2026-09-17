import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import addon from "./index.js";
import { getA2aRuntimeStatus, requireA2aExecutionReady } from "./runtime.js";
import { A2A_PROFILE } from "./profile.js";

test("profile stage registers only bounded read-only status/profile, no network or host routes", async () => {
  const tools: any[] = [];
  const hooks = new Map<string, () => { skillPaths: string[] }>();
  let network = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    network++;
    throw new Error("Network forbidden");
  }) as unknown as typeof fetch;
  try {
    addon({
      registerTool: (t: unknown) => tools.push(t),
      on: (name: string, handler: () => { skillPaths: string[] }) =>
        hooks.set(name, handler),
    } as never);
    expect(tools.map((t) => t.name)).toEqual(["a2a"]);
    expect(tools[0].parameters.properties.action.enum).toEqual([
      "status",
      "profile",
    ]);
    const status = await tools[0].execute("test", { action: "status" });
    expect(status.details).toMatchObject({
      enabled: false,
      stage: "profile-validation",
      networkActive: false,
    });
    expect(status.content[0].text.length).toBeLessThan(4096);
    await expect(tools[0].execute("test", { action: "send" })).rejects.toThrow(
      "Unsupported A2A action",
    );
    expect(getA2aRuntimeStatus().enabled).toBe(false);
    expect(() => requireA2aExecutionReady()).toThrow("disabled");
    expect(hooks.has("resources_discover")).toBe(true);
    for (const path of hooks.get("resources_discover")!().skillPaths)
      expect(await Bun.file(path).exists()).toBe(true);
    expect(network).toBe(0);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("normative protobuf bytes and package SDK version match the committed provenance", async () => {
  const provenance = await Bun.file(
    new URL("./protocol/provenance.json", import.meta.url),
  ).json();
  const proto = await Bun.file(
    new URL("./protocol/a2a.proto", import.meta.url),
  ).arrayBuffer();
  expect(createHash("sha256").update(new Uint8Array(proto)).digest("hex")).toBe(
    provenance.schema.sha256,
  );
  expect(provenance.schema.commit).toBe(A2A_PROFILE.specificationCommit);
  const pkg = await Bun.file(new URL("./package.json", import.meta.url)).json();
  expect(pkg.dependencies[A2A_PROFILE.sdk]).toBe(A2A_PROFILE.sdkVersion);
  expect(pkg.pi.runtime).toEqual({ entries: ["runtime.ts"], load: "startup" });
  expect(provenance.schema.version).toBe(A2A_PROFILE.specification);
});
