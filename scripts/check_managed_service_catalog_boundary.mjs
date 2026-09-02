#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionRoots = [
  'internal/managedwebservice',
  'internal/portforward',
  'internal/codeapp/appserver',
  'internal/envapp/ui_src/src/ui/pages',
  'internal/envapp/ui_src/src/ui/i18n',
  'internal/envapp/ui_src/src/ui/icons',
  'desktop/src/shared/i18n',
];
const productionFiles = [
  'internal/codeapp/codeapp.go',
  'scripts/generate_third_party_notices.mjs',
  'THIRD_PARTY_NOTICES.md',
];
const forbidden = [
  /deepseek-harness-(?:host|container)/iu,
  /@deepseek-ai\/dsh/iu,
  /ghcr\.io\/runzhliu\/deepseek-harness/iu,
  /linuxserver-webtop/iu,
  /lscr\.io\/linuxserver\/webtop/iu,
  /DeepSeek Harness/u,
  /LinuxServer Webtop/u,
  /redeven-dsh/iu,
];

function collect(root) {
  const absolute = path.join(repoRoot, root);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = path.join(root, entry.name);
    if (entry.isDirectory()) return collect(relative);
    if (!entry.isFile() || relative.endsWith('_test.go') || /(?:^|\.)test\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
    return [relative];
  });
}

const localeCatalog = path.join(repoRoot, 'internal/envapp/ui_src/src/ui/i18n/locales/catalogs');
const files = [
  ...productionRoots.flatMap(collect),
  ...productionFiles,
  ...fs.readdirSync(localeCatalog).filter((name) => name.endsWith('.json')).map((name) => path.relative(repoRoot, path.join(localeCatalog, name))),
];
const violations = [];
for (const file of [...new Set(files)].sort()) {
  const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const pattern of forbidden) {
      if (pattern.test(line)) violations.push(`${file}:${index + 1}: ${pattern}`);
      pattern.lastIndex = 0;
    }
  });
}

if (violations.length > 0) {
  console.error(`Managed Service catalog boundary violations:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}
console.log('Managed Service catalog boundary passed.');
