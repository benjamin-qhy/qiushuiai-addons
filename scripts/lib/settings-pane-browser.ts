/** Disposable component fixture. Core owns actual Settings-host integration. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const settingsBrowserEnabled = process.env.PICLAW_E2E_DISPOSABLE === "1"
  && !!process.env.PICLAW_SETTINGS_CORE_SOURCE;

export async function settingsPaneFixture(entry: string) {
  const core = process.env.PICLAW_SETTINGS_CORE_SOURCE!;
  if (!settingsBrowserEnabled || !core.startsWith("/")) throw new Error("Explicit disposable companion core required");
  const { chromium } = await import(join(core, "node_modules/playwright/index.mjs"));
  const root = mkdtempSync(join(tmpdir(), "addon-settings-fixture-"));
  let browser: any;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const preact = join(core, "node_modules/preact");
    const shim = join(root, "entry.ts");
    await Bun.write(shim, `
      import {h,render} from ${JSON.stringify(preact + "/dist/preact.module.js")};
      import * as hooks from ${JSON.stringify(preact + "/hooks/dist/hooks.module.js")};
      import htm from ${JSON.stringify(join(core, "node_modules/htm/dist/htm.module.js"))};
      globalThis.__piclawPreactHtm={html:htm.bind(h),...hooks};
      globalThis.__piclawSettingsPaneRegistry={registerSettingsPane:({component})=>render(h(component),document.getElementById('app')),notifySettingsPanesChanged:()=>{}};
      await import(${JSON.stringify(entry)});
    `);
    const built = await Bun.build({ entrypoints: [shim], target: "browser", plugins: [{
      name: "single-preact", setup(build) {
        build.onResolve({ filter: /^preact$/ }, () => ({ path: preact + "/dist/preact.module.js" }));
      },
    }] });
    if (!built.success) throw new Error(String(built.logs));
    const js = await built.outputs[0].text();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ui.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const file = Bun.file(join(core, "runtime/web", url.pathname));
        return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
      }
      if (url.pathname !== "/") return new Response("Unexpected fixture request", { status: 404 });
      const skin = url.searchParams.get("skin");
      const modern = skin === "classic" || skin === "visual";
      const cls = modern ? `${skin === "classic" ? "settings-content" : "settings-panel__content"} settings-addon-pane` : "";
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        ${modern ? `<link rel="stylesheet" href="/static/${skin}/css/styles.css">` : ""}
        <style>:root{--bg-primary:#fff;--bg-secondary:#f7f9fa;--text-primary:#18212a;--text-secondary:#54606c;--border-color:#b7bfc7;--accent-color:#2783b8;--danger-color:#b3261e}body{margin:0;overflow:auto;font:15px system-ui}#app{box-sizing:border-box;width:100%;max-width:850px;height:auto;min-height:0;padding:12px;overflow:visible}</style>
        </head><body><main id="app" class="${cls}"></main><script type="module" src="/ui.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
    } });
    browser = await chromium.launch({ headless: true });
    return {
      async page(skin: string, width = 390) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e: Error) => errors.push(e.message));
        await page.route("**/*", (route: any) => new URL(route.request().url()).origin === server!.url.origin ? route.continue() : route.abort());
        return { page, errors, url: server!.url.href + "?skin=" + skin };
      },
      async close() { await browser.close(); server!.stop(true); rmSync(root, { recursive: true, force: true }); },
    };
  } catch (error) {
    await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true }); throw error;
  }
}
