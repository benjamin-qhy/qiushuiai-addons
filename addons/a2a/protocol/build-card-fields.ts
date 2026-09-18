/** Offline generator for AgentCard's protobuf field-presence rules. No network. */
import { readFileSync, writeFileSync } from "node:fs";
const text = readFileSync(
  new URL("./a2a.proto", import.meta.url),
  "utf8",
).replace(/\/\/[^\n]*/g, "");
const messages: Record<string, Record<string, unknown>> = {};
for (const match of text.matchAll(/^message (\w+)\s*\{/gm)) {
  const start = match.index! + match[0].length;
  let depth = 1,
    end = start;
  while (depth && end < text.length) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
    end++;
  }
  let body = text.slice(start, end - 1);
  const oneofs = new Set<string>();
  for (const group of body.matchAll(/oneof\s+\w+\s*\{([^}]+)\}/g))
    for (const f of group[1].matchAll(/\b(\w+)\s*=\s*\d+/g)) oneofs.add(f[1]);
  const fields: Record<string, unknown> = {};
  for (const field of body.matchAll(
    /\b(?:(optional|repeated)\s+)?(map\s*<\s*string\s*,\s*[\w.]+\s*>|[\w.]+)\s+(\w+)\s*=\s*\d+\s*(\[[\s\S]*?\])?\s*;/g,
  )) {
    const [, label, type, name, options] = field;
    const map = /^map\s*<\s*string\s*,\s*([\w.]+)\s*>$/.exec(type);
    fields[name.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())] = {
      type: map ? map[1] : type,
      ...(map ? { map: true } : {}),
      ...(label === "repeated" ? { repeated: true } : {}),
      ...(label === "optional" || oneofs.has(name) ? { presence: true } : {}),
      ...(options?.includes("REQUIRED") ? { required: true } : {}),
    };
  }
  messages[match[1]] = fields;
}
const selected: typeof messages = {};
function visit(name: string) {
  if (selected[name] || !messages[name]) return;
  selected[name] = messages[name];
  for (const field of Object.values(messages[name]) as any[]) visit(field.type);
}
visit("AgentCard");
if (
  Object.keys(selected).length < 15 ||
  Object.keys(selected.AgentCard).length !== 14
)
  throw new Error(
    "Unexpected pinned AgentCard schema shape " +
      Object.keys(selected).length +
      " " +
      Object.keys(selected.AgentCard).length,
  );
const output = JSON.stringify(selected, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (
    readFileSync(new URL("./card-fields.json", import.meta.url), "utf8") !==
    output
  )
    throw new Error("Agent Card field rules are stale");
} else writeFileSync(new URL("./card-fields.json", import.meta.url), output);
console.log(
  Object.keys(selected).length,
  "Agent Card message definitions",
  process.argv.includes("--check") ? "verified" : "generated",
);
