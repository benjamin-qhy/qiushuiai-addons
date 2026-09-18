import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import sampleAddon from "./index.ts";

test("sample addon exports an extension entrypoint", () => {
  expect(typeof sampleAddon).toBe("function");
});

test("sample compat storage avoids runtime source imports", () => {
  const source = readFileSync(join(import.meta.dir, "compat", "extension-kv.ts"), "utf8");
  expect(source).not.toContain("require(");
  expect(source).not.toContain("piclaw/runtime/src");
});

test("sample settings uses labelled host controls with scoped older-host fallback", () => {
  const source = readFileSync(join(import.meta.dir, "web/index.ts"), "utf8");
  const css = readFileSync(join(import.meta.dir, "web/styles.ts"), "utf8");
  expect(source).toContain('class="sample-addon-settings"');
  expect(source).toContain('for="sample-addon-api-key"');
  expect(source).toContain('aria-describedby="sample-addon-api-key-help"');
  expect(source).toContain('class="settings-addon-control-group"');
  expect(source).not.toContain('148px');
  expect(css).toContain('@layer sample-addon-settings-fallback');
  expect(source).toContain('from "./styles.ts"');
  expect(source).toContain('parentElement?.querySelector?.(\'input[type="password"]\')');
});

test("sample browser acceptance steps never write through API fallbacks", () => {
  const source = readFileSync(join(import.meta.dir, "tests/steps/settings.steps.ts"), "utf8");
  expect(source).not.toContain("request.post");
  expect(source).not.toContain("saveGreetingViaApi");
  expect(source).toContain("await expect(input).toHaveValue(value");
  expect(source).toContain("await expect(indicator).toBeVisible");
});
