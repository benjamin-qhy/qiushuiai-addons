import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function option(name: string) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const inputUrl = option("--url") || process.env.QIUSHUIAI_WEB_URL;
if (!inputUrl) throw new Error("Provide the actual QiushuiAI Web URL with --url.");
const url = new URL(inputUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) throw new Error("Only the local QiushuiAI instance may be captured.");
const slug = option("--addon") || "sample-addon";
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("Invalid add-on identifier.");
const output = resolve(option("--out") || `exports/${slug}-settings.png`);
const binary = [process.env.QIUSHUIAI_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", Bun.which("chromium"), Bun.which("google-chrome")].find((path): path is string => Boolean(path && existsSync(path)));
if (!binary) throw new Error("Chrome or Chromium is required for a real settings screenshot.");
mkdirSync(dirname(output), { recursive: true });
const browser = await chromium.launch({ executablePath: binary, headless: true, timeout: 30_000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(new URL("/settings/addons", url).href, { waitUntil: "domcontentloaded" });
  const row = page.getByRole("article").filter({ has: page.getByRole("switch", { name: new RegExp(` ${slug}$`) }) });
  await row.getByRole("button").click({ timeout: 30_000 });
  await page.getByRole("menuitem", { name: /^(Details|详情)$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^(Save|保存)$/ }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const box = await dialog.boundingBox();
  if (!box || box.width < 100 || box.height < 100) throw new Error("No visible settings dialog was found.");
  await dialog.screenshot({ path: output, mask: [dialog.locator('input[type="password"]')] });
  console.log(JSON.stringify({ path: output, width: box.width, height: box.height, addon: slug, source: url.origin }));
} finally { await browser.close(); }
