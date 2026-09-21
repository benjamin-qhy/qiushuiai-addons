import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoDir = import.meta.dir;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function importStandaloneAddon(slug: "kanban-editor" | "observability" | "plan-sidebar" | "sample-addon" | "vent") {
  const tempRoot = mkdtempSync(join(tmpdir(), `qiushuiai-addon-${slug}-`));
  tempDirs.push(tempRoot);

  const packageDir = join(tempRoot, `qiushuiai-addon-${slug}`);
  cpSync(join(repoDir, "addons", slug), packageDir, { recursive: true });

  const manifestPath = join(packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
    const rootManifest = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
    manifest.devDependencies ||= {};
    for (const peerName of Object.keys(manifest.peerDependencies ?? {})) {
      const pinned = rootManifest.devDependencies?.[peerName];
      if (typeof pinned === "string") manifest.devDependencies[peerName] = pinned;
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const installed = Bun.spawnSync(["bun", "install", "--force"], {
      cwd: packageDir,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(repoDir, ".tmp", "standalone-bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (installed.exitCode !== 0) {
      throw new Error(`Failed to install runtime dependencies for ${slug}: ${installed.stderr.toString()}`);
    }
  } else {
    symlinkSync(join(repoDir, "node_modules"), join(tempRoot, "node_modules"), "dir");
  }
  return import(pathToFileURL(join(packageDir, manifest.main || "index.ts")).href);
}


for (const slug of ["kanban-editor", "observability", "plan-sidebar", "sample-addon", "vent"] as const) {
 test(`standalone ${slug} imports outside the repository`, async () => {
  const mod = await importStandaloneAddon(slug);
  expect(typeof mod.default).toBe("function");
 }, 120_000);
}
