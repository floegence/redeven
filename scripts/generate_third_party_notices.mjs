#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outputPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const checkOnly = process.argv.includes('--check');

const npmLicenseOverrides = new Map([
  ['@floegence/floe-webapp-boot', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['@floegence/floe-webapp-core', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['@floegence/floe-webapp-protocol', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['khroma', { license: 'MIT', note: 'The published README declares MIT copyright for the package authors.' }],
]);

const goLicenseOverrides = new Map([
  ['github.com/floegence/floeterm/terminal-go', { license: 'MIT', note: 'Floegence first-party dependency.' }],
  ['github.com/floegence/flowersec/flowersec-go', { license: 'MIT', note: 'Floegence first-party dependency.' }],
]);

const goLicensePrefixFallbacks = [
  { prefix: 'cloud.google.com/go/', license: 'Apache-2.0', note: 'Google Cloud Go modules are distributed under Apache-2.0.' },
  { prefix: 'github.com/aws/', license: 'Apache-2.0', note: 'AWS SDK for Go modules are distributed under Apache-2.0.' },
  { prefix: 'github.com/Azure/', license: 'MIT', note: 'Azure SDK for Go modules are distributed under MIT.' },
  { prefix: 'github.com/AzureAD/', license: 'MIT', note: 'Microsoft authentication library for Go is distributed under MIT.' },
  { prefix: 'github.com/prometheus/', license: 'Apache-2.0', note: 'Prometheus Go modules are distributed under Apache-2.0.' },
  { prefix: 'go.opencensus.io', license: 'Apache-2.0', note: 'OpenCensus Go is distributed under Apache-2.0.' },
  { prefix: 'go.opentelemetry.io/', license: 'Apache-2.0', note: 'OpenTelemetry Go modules are distributed under Apache-2.0.' },
  { prefix: 'google.golang.org/api', license: 'BSD-style', note: 'Google API Go client is distributed under a BSD-style license.' },
  { prefix: 'google.golang.org/genproto', license: 'Apache-2.0', note: 'Google generated protocol modules are distributed under Apache-2.0.' },
  { prefix: 'google.golang.org/grpc', license: 'Apache-2.0', note: 'gRPC Go is distributed under Apache-2.0.' },
  { prefix: 'google.golang.org/protobuf', license: 'BSD-style', note: 'Protocol Buffers Go is distributed under a BSD-style license.' },
  { prefix: 'golang.org/x/', license: 'BSD-style', note: 'Go sub-repository modules are distributed under a BSD-style license.' },
  { prefix: 'github.com/golang/', license: 'BSD-style', note: 'Go project modules are distributed under a BSD-style license.' },
  { prefix: 'github.com/google/', license: 'Apache-2.0', note: 'Google-maintained Go module fallback; verify on dependency changes.' },
  { prefix: 'github.com/googleapis/', license: 'Apache-2.0', note: 'Google APIs module fallback; verify on dependency changes.' },
  { prefix: 'github.com/go-logr/', license: 'Apache-2.0', note: 'go-logr modules are distributed under Apache-2.0.' },
  { prefix: 'github.com/beorn7/', license: 'MIT', note: 'Fallback for beorn7 module license metadata.' },
  { prefix: 'github.com/cespare/xxhash', license: 'MIT', note: 'xxhash Go module is distributed under MIT.' },
  { prefix: 'github.com/felixge/httpsnoop', license: 'MIT', note: 'httpsnoop is distributed under MIT.' },
  { prefix: 'github.com/golang-jwt/jwt', license: 'MIT', note: 'golang-jwt is distributed under MIT.' },
  { prefix: 'github.com/klauspost/compress', license: 'Apache-2.0', note: 'klauspost/compress is distributed under Apache-2.0.' },
  { prefix: 'github.com/kylelemons/godebug', license: 'Apache-2.0', note: 'godebug is distributed under Apache-2.0.' },
  { prefix: 'github.com/munnerz/goautoneg', license: 'BSD-style', note: 'goautoneg is distributed under a BSD-style license.' },
  { prefix: 'github.com/pkg/browser', license: 'BSD-style', note: 'pkg/browser is distributed under a BSD-style license.' },
];

const packageLockSources = [
  { label: 'Desktop shell', file: 'desktop/package-lock.json' },
  { label: 'Env App UI', file: 'internal/envapp/ui_src/package-lock.json' },
  { label: 'Code App UI', file: 'internal/codeapp/ui_src/package-lock.json' },
];

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeLicense(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'UNKNOWN';
  return text.replace(/\s+/g, ' ');
}

function npmPackageName(packagePath) {
  const parts = packagePath.split('node_modules/');
  return parts[parts.length - 1] ?? packagePath;
}

function mergeEntry(map, entry) {
  const existing = map.get(entry.key);
  if (!existing) {
    map.set(entry.key, entry);
    return;
  }
  existing.scopes = Array.from(new Set([...existing.scopes, ...entry.scopes])).sort();
  existing.notes = Array.from(new Set([...existing.notes, ...entry.notes].filter(Boolean))).sort();
  if (existing.license === 'UNKNOWN' && entry.license !== 'UNKNOWN') {
    existing.license = entry.license;
  }
}

function collectNpmEntries() {
  const entries = new Map();

  for (const source of packageLockSources) {
    const absolutePath = path.join(repoRoot, source.file);
    const lock = readJSON(absolutePath);
    for (const [packagePath, meta] of Object.entries(lock.packages ?? {})) {
      if (!packagePath.includes('node_modules/')) continue;

      const name = npmPackageName(packagePath);
      const version = String(meta.version ?? '').trim();
      if (!name || !version) continue;

      const override = npmLicenseOverrides.get(name);
      const license = normalizeLicense(override?.license ?? meta.license);
      const notes = [];
      if (override?.note) notes.push(override.note);
      if (license.includes('GPL') && /\bMIT\b/.test(license)) {
        notes.push('Redeven uses this dual-licensed package under the MIT option.');
      }

      mergeEntry(entries, {
        key: `npm:${name}@${version}`,
        ecosystem: 'npm',
        name,
        version,
        license,
        source: `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}`,
        scopes: [source.label],
        notes,
      });
    }
  }

  return Array.from(entries.values()).sort(compareEntries);
}

function splitGoModuleJSON(output) {
  const chunks = output.trim().split(/\n(?=\{)/u).filter(Boolean);
  return chunks.map((chunk) => JSON.parse(chunk));
}

function goListModules() {
  const env = { ...process.env, GOFLAGS: appendGoFlag(process.env.GOFLAGS, '-mod=readonly') };
  const output = execFileSync('go', ['list', '-m', '-json', 'all'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return splitGoModuleJSON(output);
}

function hydrateGoModuleSources() {
  const env = { ...process.env, GOFLAGS: appendGoFlag(process.env.GOFLAGS, '-mod=readonly') };
  execFileSync('go', ['mod', 'download', 'all'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function appendGoFlag(current, next) {
  const value = String(current ?? '').trim();
  if (!value) return next;
  if (value.split(/\s+/u).includes(next)) return value;
  return `${value} ${next}`;
}

function findLicenseFiles(moduleDir) {
  if (!moduleDir || !fs.existsSync(moduleDir)) return [];
  const names = fs.readdirSync(moduleDir);
  return names
    .filter((name) => /^(LICENSE|LICENCE|COPYING)([.-].*)?$/iu.test(name))
    .map((name) => path.join(moduleDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort();
}

function detectLicenseFromText(text) {
  const sample = text.slice(0, 20000);
  if (/Mozilla Public License,?\s*(?:version|Version)\s*2\.0|Mozilla Public License Version 2\.0/u.test(sample)) return 'MPL-2.0';
  if (/Apache License\s+Version 2\.0/u.test(sample)) return 'Apache-2.0';
  if (/MIT License/u.test(sample) || /Permission is hereby granted, free of charge/u.test(sample)) return 'MIT';
  if (/ISC License/u.test(sample) || /Permission to use, copy, modify, and\/or distribute this software/u.test(sample)) return 'ISC';
  if (/The Unlicense/u.test(sample)) return 'Unlicense';
  if (/Redistribution and use in source and binary forms/u.test(sample)) return 'BSD-style';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/u.test(sample)) return 'AGPL';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/u.test(sample)) return 'LGPL';
  if (/GNU GENERAL PUBLIC LICENSE/u.test(sample)) return 'GPL';
  return 'UNKNOWN';
}

function detectGoLicense(moduleInfo) {
  const override = goLicenseOverrides.get(moduleInfo.Path);
  if (override) return override;

  const licenseFiles = findLicenseFiles(moduleInfo.Dir);
  if (licenseFiles.length === 0) {
    const fallback = goLicensePrefixFallbacks.find((entry) => moduleInfo.Path === entry.prefix || moduleInfo.Path.startsWith(entry.prefix));
    if (fallback) return { license: fallback.license, note: fallback.note };
    return { license: 'UNKNOWN', note: moduleInfo.Dir ? 'No top-level license file was found in the downloaded module.' : 'Module source was not downloaded before notice generation.' };
  }

  const detected = [];
  for (const filePath of licenseFiles) {
    detected.push(detectLicenseFromText(fs.readFileSync(filePath, 'utf8')));
  }
  const known = detected.find((license) => license !== 'UNKNOWN');
  return {
    license: known ?? 'UNKNOWN',
    note: licenseFiles.length > 1 ? `Detected from ${licenseFiles.map((filePath) => path.basename(filePath)).join(', ')}.` : `Detected from ${path.basename(licenseFiles[0])}.`,
  };
}

function collectGoEntries() {
  const entries = [];
  hydrateGoModuleSources();
  for (const moduleInfo of goListModules()) {
    if (moduleInfo.Main) continue;
    const version = String(moduleInfo.Version ?? '').trim();
    if (!moduleInfo.Path || !version) continue;

    const detected = detectGoLicense(moduleInfo);
    entries.push({
      key: `go:${moduleInfo.Path}@${version}`,
      ecosystem: 'go',
      name: moduleInfo.Path,
      version,
      license: normalizeLicense(detected.license),
      source: `https://pkg.go.dev/${moduleInfo.Path}@${version}`,
      scopes: ['Runtime'],
      notes: [detected.note].filter(Boolean),
    });
  }
  return entries.sort(compareEntries);
}

function compareEntries(a, b) {
  return `${a.ecosystem}:${a.name}@${a.version}`.localeCompare(`${b.ecosystem}:${b.name}@${b.version}`);
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function renderTable(entries) {
  const lines = [
    '| Component | Version | License | Used by | Source | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of entries) {
    lines.push(`| ${escapeCell(entry.name)} | ${escapeCell(entry.version)} | ${escapeCell(entry.license)} | ${escapeCell(entry.scopes.join(', '))} | ${escapeCell(entry.source)} | ${escapeCell(entry.notes.join(' '))} |`);
  }
  return lines.join('\n');
}

function policyViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    const license = entry.license;
    if (license === 'UNKNOWN' || license === 'MISSING') {
      violations.push(`${entry.name}@${entry.version}: missing or unknown license`);
      continue;
    }
    if (/(AGPL|SSPL|BUSL|Commons Clause|Elastic License|PolyForm)/iu.test(license)) {
      violations.push(`${entry.name}@${entry.version}: disallowed license ${license}`);
      continue;
    }
    if (/\bGPL\b|GPL-\d/iu.test(license) && !/\b(MIT|Apache-2\.0|MPL-2\.0|BSD|ISC)\b/iu.test(license)) {
      violations.push(`${entry.name}@${entry.version}: GPL-only style license ${license}`);
    }
    if (/\bLGPL\b|LGPL-\d/iu.test(license)) {
      violations.push(`${entry.name}@${entry.version}: LGPL license requires explicit review (${license})`);
    }
  }
  return violations;
}

function renderNotices(goEntries, npmEntries) {
  return `# Third-Party Notices

Generated by \`scripts/generate_third_party_notices.mjs\`.

Redeven itself is licensed under the MIT License; see \`LICENSE\`.

This inventory is intentionally broad: it includes Go modules used by the runtime and JavaScript packages used to build the embedded Env App, Code App, and Desktop shell. Some JavaScript packages are build-time only, but keeping them in one auditable notice file avoids accidental omission when build output changes.

## Go Modules

${renderTable(goEntries)}

## JavaScript Packages

${renderTable(npmEntries)}

## Desktop Runtime Notices

Redeven Desktop packages Electron and Chromium runtime components. Desktop release artifacts include Electron's \`LICENSE\` and \`LICENSES.chromium.html\` files under \`licenses/electron/\` in addition to this notice file.

## License Policy Guard

The generator fails on missing licenses and on licenses that are not acceptable for Redeven's public binary and desktop distribution without explicit review, including AGPL, GPL-only, LGPL, SSPL, BUSL, Commons Clause, Elastic License, and PolyForm-style licenses.
`;
}

const goEntries = collectGoEntries();
const npmEntries = collectNpmEntries();
const allEntries = [...goEntries, ...npmEntries];
const violations = policyViolations(allEntries);
if (violations.length > 0) {
  console.error('Third-party license policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

const nextContent = renderNotices(goEntries, npmEntries);
if (checkOnly) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (current !== nextContent) {
    console.error('THIRD_PARTY_NOTICES.md is stale. Run: node scripts/generate_third_party_notices.mjs');
    process.exit(1);
  }
  console.log('Third-party notices are up to date.');
} else {
  fs.writeFileSync(outputPath, nextContent);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}
