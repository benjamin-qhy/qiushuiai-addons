import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** Preserve notices for the dependencies included in the runtime bundle. */
function dependencyNotices(source: string, dependencies: Record<string, string>): string {
  const visited = new Set<string>();
  const notices: string[] = [];
  const collect = (from: string, name: string) => {
    let current = resolve(from);
    let directory: string | null = null;
    while (true) {
      const candidate = join(current, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) { directory = candidate; break; }
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
    if (!directory || visited.has(directory)) return;
    visited.add(directory);
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const files = readdirSync(directory).filter(name => /^(license|licence|notice)(\.|$)/i.test(name));
    notices.push(`${pkg.name}@${pkg.version} (${pkg.license ?? "see package"})\n` + files.map(file => readFileSync(join(directory!, file), "utf8")).join("\n"));
    for (const child of Object.keys(pkg.dependencies ?? {})) collect(directory, child);
  };
  for (const name of Object.keys(dependencies)) collect(source, name);
  return notices.join("\n\n----------------------------------------\n\n") + "\n";
}

/** Publish the same runtime bytes used for local acceptance. Keep host peers external. */
export async function preparePublishedAddon(source: string): Promise<{ directory: string; dispose(): void }> {
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (manifest.name !== "@qiushuiai/qiushuiai-addon-observability") return { directory: source, dispose() {} };
  const directory = mkdtempSync(join(tmpdir(), "qiushuiai-addon-package-"));
  try {
    cpSync(source, directory, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part === "node_modules" || part === ".git") });
    const result = await Bun.build({
      entrypoints: [join(source, "index.ts")],
      target: "bun",
      format: "esm",
      minify: true,
      external: Object.keys(manifest.peerDependencies ?? {}),
      outdir: directory,
      naming: "runtime.js",
    });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    manifest.main = "runtime.js";
    manifest.pi.extensions = ["runtime.js"];
    writeFileSync(join(directory, "THIRD-PARTY-NOTICES.txt"), dependencyNotices(source, manifest.dependencies ?? {}));
    delete manifest.dependencies;
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    return { directory, dispose: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const prepared = await preparePublishedAddon(process.argv[2]!);
  console.log(prepared.directory);
}
