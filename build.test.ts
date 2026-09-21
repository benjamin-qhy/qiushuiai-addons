import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL(".", import.meta.url).pathname;
const buildSource = readFileSync(new URL("./build.ts", import.meta.url), "utf8");

test("generated site contains only current catalog plugins and packages", () => {
  const catalog = JSON.parse(readFileSync(join(repoRoot, "catalog.json"), "utf8"));
  const slugs = catalog.addons.map((addon: { slug: string }) => addon.slug).sort();
  expect(readdirSync(join(repoRoot, "docs/addons")).sort()).toEqual(slugs);
  const packages = catalog.addons.map((addon: { name: string; version: string }) =>
    `${addon.name.replace(/^@[^/]+\//, "")}-${addon.version}.tgz`).sort();
  expect(readdirSync(join(repoRoot, "docs/packages")).filter(name => name.endsWith(".tgz")).sort()).toEqual(packages);
});

test("addon detail pages include a direct tarball download pill", () => {
  expect(buildSource).toContain("function downloadPill(addon: Addon)");
  expect(buildSource).toContain("class=\"download-pill\"");
  expect(buildSource).toContain("href=\"${esc(tarballUrl(addon))}\"");
  expect(buildSource).toContain("${downloadPill(addon)}");
});

test("featured cards render an accessible top-right bookmark", () => {
  expect(buildSource).toContain("function coreBookmark(addon: Addon)");
  expect(buildSource).toContain('if (!addon.featured) return ""');
  expect(buildSource).toContain('class="core-bookmark" role="img" aria-label="核心推荐插件"');
  expect(buildSource).toContain("核心推荐插件，适合大多数 QiushuiAI 用户");
  expect(buildSource).toContain('class="card${a.featured ? " card-core" : ""}"');
  expect(buildSource).toContain("${coreBookmark(a)}");
  expect(buildSource).toContain(".core-bookmark{position:absolute");
  expect(buildSource).toContain(">推荐</text>");
});

test("public tarball builder excludes local dependency and temporary trees", () => {
  const source = readFileSync(join(repoRoot, "build.ts"), "utf8");
  expect(source).toContain('"--exclude=./node_modules"');
  expect(source).toContain('"--exclude=./.tmp"');
});

test("site links adapt to the repository that runs the Pages build", () => {
  expect(buildSource).toContain('const REPOSITORY = process.env.GITHUB_REPOSITORY?.trim() || "benjamin-qhy/qiushuiai-addons"');
  expect(buildSource).toContain('`https://${REPOSITORY_OWNER}.github.io/${REPOSITORY_NAME}`');
  expect(buildSource).toContain('function sitePath(path: string): string');
  expect(buildSource).not.toContain('href="/qiushuiai-addons/');
  expect(buildSource).not.toContain("from '/qiushuiai-addons/");
});

test("only the selected foundational add-ons are featured", () => {
  const packageFiles = Array.from(new Bun.Glob("addons/*/package.json").scanSync({ cwd: repoRoot })).sort();
  const coreSlugs = packageFiles.flatMap((path) => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
    return manifest.qiushuiai?.featured === true ? [path.split("/")[1]] : [];
  });
  expect(coreSlugs).toEqual(["observability"]);

  const catalog = JSON.parse(readFileSync(join(repoRoot, "catalog.json"), "utf8"));
  const catalogCoreSlugs = catalog.addons.filter((addon: any) => addon.featured === true).map((addon: any) => addon.slug).sort();
  expect(catalogCoreSlugs).toEqual(coreSlugs);
  const manifestVersions = Object.fromEntries(coreSlugs.map((slug) => [slug, JSON.parse(readFileSync(join(repoRoot, "addons", slug!, "package.json"), "utf8")).version]));
  expect(Object.fromEntries(catalog.addons.filter((addon: any) => catalogCoreSlugs.includes(addon.slug)).map((addon: any) => [addon.slug, addon.version]))).toEqual(manifestVersions);
});
