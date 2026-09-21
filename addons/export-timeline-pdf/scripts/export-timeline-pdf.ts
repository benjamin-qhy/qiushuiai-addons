#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Export a chat timeline to PDF using the internal localhost export endpoint and wkhtmltopdf.",
 *   "aliases": ["export timeline pdf"],
 *   "domains": ["timeline", "pdf"],
 *   "verbs": ["export"],
 *   "nouns": ["timeline", "pdf"],
 *   "keywords": ["export", "timeline", "pdf", "wkhtmltopdf"],
 *   "guidance": ["Runnable script entrypoint.", "Workspace-owned script surface."],
 *   "examples": ["export timeline pdf"],
 *   "kind": "mixed",
 *   "weight": "heavy",
 *   "role": "entrypoint"
 * }
 */
/**
 * export-timeline-pdf.ts — Internal timeline PDF export.
 *
 * Read-only by design:
 * - never opens SQLite
 * - never writes auth/session state
 * - fetches printable HTML from the localhost internal export endpoint
 * - renders the fetched local HTML sidecar via wkhtmltopdf
 */

import { accessSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const HELP = `Usage: bun export-timeline-pdf.ts [options]

Export a chat timeline to a PDF using the internal localhost export endpoint.

Range options (all optional, combinable):
  --from <iso>           Start timestamp (ISO 8601)
  --to <iso>             End timestamp (ISO 8601)
  --from-row <id>        Start message row ID
  --to-row <id>          End message row ID
  --last <n>             Export only the last N messages

Other options:
  --chat <jid>           Current conversation JID (required unless QIUSHUIAI_CHAT_JID is set)
  --theme <light|dark>   Color theme (default: light)
  --out <path>           Output PDF path
  --port <n>             QiushuiAI web server port (default: auto-detect or 8080)
  --auth-key <key>       Internal export auth key (defaults to env/config lookup)
  --html-only            Write HTML sidecar and exit without PDF generation`;

export interface ExportTimelinePdfOptions {
  chatJid: string;
  fromTs: string;
  toTs: string;
  fromRow: string;
  toRow: string;
  lastN: string;
  theme: "light" | "dark";
  outPath: string;
  portArg: string;
  htmlOnly: boolean;
  authKeyArg: string;
}

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    const value = args[idx + 1];
    if (!value.startsWith("--")) return value;
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function safeChatPathSegment(chatJid: string): string {
  return chatJid.replace(/[^a-z0-9]+/gi, "_");
}

function assertPositiveIntegerString(value: string, label: string): void {
  if (!value) return;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

export function parseCliArgs(args = process.argv.slice(2)): ExportTimelinePdfOptions {
  const chatJid = getArg(args, "--chat") || process.env.QIUSHUIAI_CHAT_JID || "";
  if (!chatJid.trim()) throw new Error("Pass the current conversation with --chat; no default conversation is assumed.");
  const fromTs = getArg(args, "--from") || "";
  const toTs = getArg(args, "--to") || "";
  const fromRow = getArg(args, "--from-row") || "";
  const toRow = getArg(args, "--to-row") || "";
  const lastN = getArg(args, "--last") || "";
  const theme = (getArg(args, "--theme") || "light").toLowerCase();
  const outPath = resolve(getArg(args, "--out") || join("exports", `timeline-${safeChatPathSegment(chatJid)}.pdf`));
  const portArg = getArg(args, "--port") || process.env.QIUSHUIAI_WEB_PORT || "";
  const htmlOnly = hasFlag(args, "--html-only");
  const authKeyArg = getArg(args, "--auth-key") || "";

  if (theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
  assertPositiveIntegerString(fromRow, "--from-row");
  assertPositiveIntegerString(toRow, "--to-row");
  assertPositiveIntegerString(lastN, "--last");
  assertPositiveIntegerString(portArg, "--port");

  return {
    chatJid,
    fromTs,
    toTs,
    fromRow,
    toRow,
    lastN,
    theme,
    outPath,
    portArg,
    htmlOnly,
    authKeyArg,
  };
}

export function resolveOutputPaths(outPath: string): { outPath: string; htmlPath: string; outDir: string } {
  const htmlPath = /\.pdf$/i.test(outPath) ? outPath.replace(/\.pdf$/i, ".html") : `${outPath}.html`;
  return { outPath, htmlPath, outDir: dirname(outPath) || "." };
}

export async function detectPort(portArg = ""): Promise<number> {
  const value = portArg || process.env.QIUSHUIAI_WEB_PORT || "";
  assertPositiveIntegerString(value, "--port");
  if (!value || Number(value) > 65535) throw new Error("Set QIUSHUIAI_WEB_PORT or --port to the running QiushuiAI instance.");
  return Number(value);
}

function loadConfigAuthKey(): string {
  try {
    const config = JSON.parse(readFileSync("/workspace/.qiushuiai/config.json", "utf8"));
    return String(config?.web?.internalSecret || "").trim();
  } catch {
    return "";
  }
}

export function resolveAuthKey(authKeyArg = ""): string {
  return (
    authKeyArg ||
    process.env.QIUSHUIAI_EXPORT_AUTH_KEY ||
    process.env.QIUSHUIAI_INTERNAL_SECRET ||
    process.env.QIUSHUIAI_WEB_INTERNAL_SECRET ||
    loadConfigAuthKey()
  ).trim();
}

export function buildExportUrl(port: number, options: ExportTimelinePdfOptions): string {
  const params = new URLSearchParams();
  params.set("chat_jid", options.chatJid);
  params.set("theme", options.theme);
  if (options.fromTs) params.set("from", options.fromTs);
  if (options.toTs) params.set("to", options.toTs);
  if (options.fromRow) params.set("from_row", options.fromRow);
  if (options.toRow) params.set("to_row", options.toRow);
  if (options.lastN) params.set("last", options.lastN);
  return `http://127.0.0.1:${port}/internal/export/timeline?${params.toString()}`;
}

export async function fetchExportHtml(url: string, authKey: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authKey}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Export endpoint returned ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes('id="export-root"')) {
    throw new Error("Export endpoint returned unexpected HTML");
  }
  if (!html.includes('data-render-done="true"')) {
    throw new Error("Export HTML missing render completion marker");
  }
  return html;
}

export function ensureWkhtmltopdf(): string {
  const candidate = spawnSync("bash", ["-lc", "command -v wkhtmltopdf"], { encoding: "utf8" });
  const path = (candidate.stdout || "").trim();
  if (!path) {
    throw new Error("wkhtmltopdf not found in PATH");
  }
  accessSync(path);
  return path;
}

export function buildWkhtmltopdfArgs(htmlPath: string, pdfPath: string): string[] {
  return [
    "--print-media-type",
    "--encoding", "utf-8",
    "--load-error-handling", "abort",
    "--load-media-error-handling", "ignore",
    "--enable-local-file-access",
    pathToFileURL(htmlPath).href,
    pdfPath,
  ];
}

export function runWkhtmltopdf(binary: string, htmlPath: string, pdfPath: string): void {
  const result = spawnSync(binary, buildWkhtmltopdfArgs(htmlPath, pdfPath), {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`wkhtmltopdf failed with exit code ${result.status ?? "unknown"}`);
  }
}

/** Render actual export HTML in an isolated browser and close it explicitly. */
export async function renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const candidates = [process.env.QIUSHUIAI_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", Bun.which("chromium"), Bun.which("google-chrome")];
  const chrome = candidates.find((path): path is string => Boolean(path && existsSync(path)));
  if (!chrome) return runWkhtmltopdf(ensureWkhtmltopdf(), htmlPath, pdfPath);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: chrome, headless: true, timeout: 30_000 });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(resolve(htmlPath)).href, { waitUntil: "load", timeout: 30_000 });
    await page.locator('html[data-render-done="true"] #export-root').waitFor();
    await page.pdf({ path: resolve(pdfPath), format: "A4", printBackground: true });
  } finally { await browser.close(); }
}

export async function run(options = parseCliArgs()): Promise<string> {
  const authKey = resolveAuthKey(options.authKeyArg);
  if (!authKey) {
    throw new Error("No internal export auth key configured. Pass --auth-key or set web.internalSecret / QIUSHUIAI_INTERNAL_SECRET.");
  }

  const { outPath, htmlPath, outDir } = resolveOutputPaths(options.outPath);
  mkdirSync(outDir, { recursive: true });

  const port = await detectPort(options.portArg);
  const exportUrl = buildExportUrl(port, options);

  console.error(`Using server at 127.0.0.1:${port}`);
  console.error(`Export URL: ${exportUrl}`);

  const html = await fetchExportHtml(exportUrl, authKey);
  writeFileSync(htmlPath, html, "utf8");
  console.error(`HTML written: ${htmlPath}`);

  if (options.htmlOnly) {
    process.stdout.write(htmlPath);
    return htmlPath;
  }

  await renderPdf(htmlPath, outPath);

  if (!existsSync(outPath)) {
    throw new Error("PDF renderer did not create the output");
  }
  const size = statSync(outPath).size;
  if (size < 1500) {
    throw new Error(`Generated PDF is unexpectedly small (${size} bytes)`);
  }

  console.error(`PDF written: ${outPath}`);
  process.stdout.write(outPath);
  return outPath;
}

if (import.meta.main) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  run().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
