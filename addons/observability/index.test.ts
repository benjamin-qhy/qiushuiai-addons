import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAppInsightsActorAttributes,
  buildRuntimeConfigKey,
  buildSyntheticDependencyAttributes,
  buildSyntheticRequestAttributes,
  modelDependencyTarget,
} from "./index.ts";

test("observability compat shims avoid runtime source imports", () => {
  for (const file of ["extension-kv.ts", "keychain.ts", "log-sink.ts"]) {
    const source = readFileSync(join(import.meta.dir, "compat", file), "utf8");
    expect(source).not.toContain("qiushuiai/runtime/src");
  }
});

test("buildRuntimeConfigKey changes only for backend runtime settings", () => {
  const base = {
    enabled: true,
    instance_name: "smith",
    appinsights_enabled: true,
    appinsights_keychain: "azure/appinsights-connection-string",
    appinsights_live_metrics: true,
    appinsights_standard_metrics: true,
    appinsights_sampling_ratio: 1,
    graphite_enabled: false,
    graphite_host: "",
    graphite_port: 2003,
    graphite_prefix: "qiushuiai",
  };
  expect(buildRuntimeConfigKey({ ...base })).toBe(buildRuntimeConfigKey(base));
  expect(buildRuntimeConfigKey({ ...base, instance_name: "smith-2" })).not.toBe(buildRuntimeConfigKey(base));
  expect(buildRuntimeConfigKey({ ...base, graphite_enabled: true, graphite_host: "graphite.local" })).not.toBe(buildRuntimeConfigKey(base));
});

test("observability consumes bounded durable compaction telemetry without a second core exporter", () => {
  const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
  expect(source).toContain('op === "compaction.telemetry"');
  expect(source).toContain('getTracer().startSpan("compaction"');
  expect(source).toContain("exportCompactionTelemetry(exportConfig)");
  const block = source.slice(source.indexOf('if (op === "compaction.telemetry")'), source.indexOf('if (op === "get_or_create.create_main_session")'));
  expect(block).not.toContain("errorMessage");
  expect(block).not.toContain("chat_jid");
  expect(block).not.toContain("generation_id");
});

test("process runtime is not torn down by individual session shutdown hooks", () => {
  const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
  expect(source).toContain("ensureProcessRuntimeConfig");
  expect(source).not.toContain('pi.on("session_shutdown"');
});

test("model spans start from authoritative model.call.start records and export speed telemetry", () => {
  const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
  expect(source).toContain('op === "model.call.start"');
  expect(source).toContain("deriveModelSpeedTelemetry");
  expect(source).toContain("buildModelSpeedSpanAttributes");
  expect(source).toContain("buildModelSpeedGraphiteMetrics");
  const toolEndBlock = source.slice(source.indexOf('if (op === "tool.call.end"'), source.indexOf('if (op === "run_agent.attempt_failed"'));
  expect(toolEndBlock).not.toContain("startModelCallSpan");
});

test("buildSyntheticRequestAttributes adds request-style semantics for agent turns", () => {
  const attrs = buildSyntheticRequestAttributes({ "qiushuiai.chat_jid": "web:default" }, "/agent/turn", "smith");
  expect(attrs).toMatchObject({
    "qiushuiai.chat_jid": "web:default",
    "http.request.method": "POST",
    "http.route": "/agent/turn",
    "server.address": "smith",
    "network.protocol.name": "qiushuiai",
    "qiushuiai.telemetry_class": "request",
  });
  expect(String(attrs["url.full"])).toBe("qiushuiai://request/agent/turn");
});

test("buildSyntheticDependencyAttributes adds dependency-style semantics for model and tool calls", () => {
  const attrs = buildSyntheticDependencyAttributes({ "qiushuiai.model": "openai/gpt-5" }, "/model/call", "openai", "model");
  expect(attrs).toMatchObject({
    "qiushuiai.model": "openai/gpt-5",
    "http.request.method": "POST",
    "http.route": "/model/call",
    "server.address": "openai",
    "peer.service": "openai",
    "network.protocol.name": "qiushuiai",
    "qiushuiai.telemetry_class": "dependency",
    "qiushuiai.dependency.kind": "model",
  });
  expect(String(attrs["url.full"])).toBe("qiushuiai://openai/model/call");
});

test("buildAppInsightsActorAttributes maps chat and session into App Insights user/session fields", () => {
  expect(buildAppInsightsActorAttributes("web:addons", "leaf-123", "smith")).toMatchObject({
    "qiushuiai.chat_jid": "web:addons",
    "qiushuiai.actor.kind": "chat_jid",
    "qiushuiai.actor.id": "web:addons",
    "enduser.id": "web:addons",
    "enduser.pseudo.id": "web:addons",
    "ai.user.authUserId": "web:addons",
    "ai.user.id": "web:addons",
    "session.id": "leaf-123",
    "ai.session.id": "leaf-123",
    "qiushuiai.session.id": "leaf-123",
    "qiushuiai.session_leaf_id": "leaf-123",
  });
});

test("modelDependencyTarget prefers the provider prefix and falls back to llm", () => {
  expect(modelDependencyTarget("azure-openai/gpt-5")).toBe("azure-openai");
  expect(modelDependencyTarget("gpt-5")).toBe("gpt-5");
  expect(modelDependencyTarget("")).toBe("llm");
  expect(modelDependencyTarget(null)).toBe("llm");
});
