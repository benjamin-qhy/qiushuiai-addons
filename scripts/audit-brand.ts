#!/usr/bin/env bun
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const allowed = new Set([
  'QIUSHUIAI-ADDON-V3-DEVELOPMENT-PLAN.md',
  'addons/a2a/docs/deployment-canary.md',
  'addons/linkr/docs/qualification-and-testing.md',
  'scripts/lib/qiushuiai-addon-identity.test.ts',
]);
const ignoredSegments = new Set(['.git', 'node_modules']);
const forbidden = [
  ['pic', 'law'].join(''),
  ['@rc', 'armo'].join(''),
  ['%40rc', 'armo'].join(''),
];

const violations: string[] = [];
const glob = new Bun.Glob('**/*');
for await (const path of glob.scan({ cwd: repoRoot, onlyFiles: true, dot: true })) {
  const normalized = path.replaceAll('\\', '/');
  if (allowed.has(normalized)) continue;
  if (normalized.split('/').some((segment) => ignoredSegments.has(segment))) continue;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await Bun.file(resolve(repoRoot, normalized)).arrayBuffer());
  } catch {
    continue;
  }
  if (bytes.includes(0)) continue;
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (forbidden.some((token) => lower.includes(token))) {
      violations.push(`${relative(repoRoot, resolve(repoRoot, normalized))}:${index + 1}:${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error(`发现 ${violations.length} 处旧品牌标识：`);
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('品牌审计通过：产品控制范围内未发现旧品牌标识。');
