#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPlatformFilteredLicensesResolvable,
  collectJavaScriptLockInventory,
  packageCoordinate,
  resolvePackageLicense,
} from './javascript_lock_inventory.mjs';
import { verifyBundledIconIntegrity } from './terminal_agent_icon_integrity.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outputPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const checkOnly = process.argv.includes('--check');
const terminalAgentIconManifestPath = path.join(repoRoot, 'assets/terminal_agent_icons.json');
const terminalAgentIconRoot = path.join(repoRoot, 'internal/envapp/ui_src/public/agent-cli-icons');
const envAppRequire = createRequire(path.join(repoRoot, 'internal/envapp/ui_src/package.json'));
const { load: parseYAML } = envAppRequire('js-yaml');
const expectedTerminalAgentIconIdentities = [
  'codex', 'claude', 'opencode', 'kimi', 'gemini', 'qwen', 'copilot', 'cline',
  'pi', 'roo', 'vibe', 'cursor', 'junie', 'kiro', 'openhands', 'trae', 'kilo',
];
const floetermThemePackageRoot = path.join(
  repoRoot,
  'internal/envapp/ui_src/node_modules/@floegence/floeterm-terminal-web',
);
const floetermThemeArtifactContract = {
  packageVersion: '0.13.4',
  files: {
    'THEME_PROVENANCE.json': '2b6b2d07297ace181564890b79e2c488e67f4747512b8adad08b4bd3ea8dfc06',
    'THEME_QUALITY_EVIDENCE.json': 'e9fdd068550001f555f1bb52ca475b68bc56a12c00da25f9ec28fe03dbdb9005',
    'THIRD_PARTY_THEME_NOTICES.md': '8e4e3c5e72cd42271cacc3cb33e9ead2283778ffdcdfbbae042927aa98689d36',
    'third_party_licenses/solarized-MIT.txt': '87623a10d8677d19b0894c61f5defd80281495a2740cb8c289891261fddda30f',
    'third_party_licenses/tokyonight-Apache-2.0.txt': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  },
};

const npmLicenseOverrides = new Map([
  ['@floegence/floe-webapp-boot', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['@floegence/floe-webapp-core', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['@floegence/floe-webapp-protocol', { license: 'MIT', note: 'License inherited from floegence/floe-webapp root LICENSE.' }],
  ['@floegence/floeterm-terminal-web', { license: 'MIT', note: 'Built-in theme attribution and license texts are reproduced below from the verified 0.13.4 package.' }],
  ['@floegence/redevplugin-ui', { license: 'MIT', note: 'License inherited from floegence/redevplugin root LICENSE.' }],
  ['khroma', { license: 'MIT', note: 'The published README declares MIT copyright for the package authors.' }],
]);

const npmCoordinateLicenseOverrides = new Map([
  ['@asamuzakjp/css-color@5.1.11', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@asamuzakjp/dom-selector@7.1.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@csstools/css-calc@3.2.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@csstools/css-color-parser@4.1.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@csstools/css-syntax-patches-for-csstree@1.1.4', { license: 'MIT-0', note: 'License verified from the exact registry package manifest.' }],
  ['@electron/rebuild@4.0.4', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@exodus/bytes@1.15.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@tailwindcss/node@4.3.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@tailwindcss/oxide@4.3.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@tailwindcss/vite@4.3.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@types/node@24.12.4', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@xmldom/xmldom@0.9.10', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['core-util-is@1.0.2', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['enhanced-resolve@5.22.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['entities@8.0.0', { license: 'BSD-2-Clause', note: 'License verified from the exact registry package manifest.' }],
  ['jsdom@29.1.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['node-abi@4.31.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['node-gyp@12.3.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['parse5@8.0.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['plist@3.1.1', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['sax@1.6.0', { license: 'BlueOak-1.0.0', note: 'License verified from the exact registry package manifest.' }],
  ['semver@7.8.1', { license: 'ISC', note: 'License verified from the exact registry package manifest.' }],
  ['tldts-core@7.4.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['tldts@7.4.0', { license: 'MIT', note: 'License verified from the exact registry package manifest.' }],
  ['@asamuzakjp/generational-cache@1.0.1', { license: 'MIT', note: 'License verified from the pnpm-installed package manifest.' }],
  ['@humanfs/types@0.15.0', { license: 'Apache-2.0', note: 'License verified from the pnpm-installed package manifest.' }],
  ['@napi-rs/canvas-android-arm64@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-darwin-arm64@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-darwin-x64@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-arm-gnueabihf@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-arm64-gnu@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-arm64-musl@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-riscv64-gnu@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-x64-gnu@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-linux-x64-musl@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-win32-arm64-msvc@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@napi-rs/canvas-win32-x64-msvc@0.1.100', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-android-arm64@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-darwin-arm64@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-darwin-x64@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-freebsd-x64@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-linux-arm-gnueabihf@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-linux-arm64-gnu@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-linux-arm64-musl@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-linux-x64-gnu@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-linux-x64-musl@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-wasm32-wasi@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-win32-arm64-msvc@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['@tailwindcss/oxide-win32-x64-msvc@4.3.0', { license: 'MIT', note: 'License audited from the exact registry package manifest.' }],
  ['lru-cache@11.5.0', { license: 'BlueOak-1.0.0', note: 'License verified from the pnpm-installed package manifest.' }],
]);

const goLicenseOverrides = new Map([
  ['github.com/floegence/floeterm/terminal-go', { license: 'MIT', note: 'Floegence first-party dependency.' }],
  ['github.com/floegence/flowersec/flowersec-go', { license: 'MIT', note: 'Floegence first-party dependency.' }],
  ['github.com/floegence/redevplugin', { license: 'MIT', note: 'Floegence first-party dependency.' }],
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

const javascriptLockSources = [
  { label: 'Desktop shell', packageLock: 'desktop/package-lock.json', pnpmLock: 'desktop/pnpm-lock.yaml' },
  { label: 'Env App UI', packageLock: 'internal/envapp/ui_src/package-lock.json', pnpmLock: 'internal/envapp/ui_src/pnpm-lock.yaml' },
  { label: 'Code App UI', packageLock: 'internal/codeapp/ui_src/package-lock.json' },
];

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function recordInstalledPackageLicense(evidence, packageJSONPath) {
  if (!fs.existsSync(packageJSONPath)) return;
  const manifest = readJSON(packageJSONPath);
  const name = String(manifest.name ?? '').trim();
  const version = String(manifest.version ?? '').trim();
  const license = normalizeLicense(manifest.license);
  if (!name || !version || license === 'UNKNOWN') return;
  const coordinate = packageCoordinate(name, version);
  const licenses = evidence.get(coordinate) ?? new Set();
  licenses.add(license);
  evidence.set(coordinate, licenses);
}

function scanInstalledNodeModules(evidence, nodeModulesRoot) {
  if (!fs.existsSync(nodeModulesRoot)) return;
  for (const entry of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(nodeModulesRoot, entry.name);
    if (entry.name.startsWith('@')) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
        recordInstalledPackageLicense(evidence, path.join(entryPath, scopedEntry.name, 'package.json'));
      }
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    recordInstalledPackageLicense(evidence, path.join(entryPath, 'package.json'));
  }
}

function collectInstalledJavaScriptLicenseEvidence() {
  const evidence = new Map();
  for (const source of javascriptLockSources.filter(({ pnpmLock }) => pnpmLock)) {
    const packageRoot = path.dirname(path.join(repoRoot, source.pnpmLock));
    const nodeModulesRoot = path.join(packageRoot, 'node_modules');
    const virtualStoreRoot = path.join(nodeModulesRoot, '.pnpm');
    scanInstalledNodeModules(evidence, nodeModulesRoot);
    if (!fs.existsSync(virtualStoreRoot)) continue;
    for (const storeEntry of fs.readdirSync(virtualStoreRoot, { withFileTypes: true })) {
      if (!storeEntry.isDirectory()) continue;
      scanInstalledNodeModules(evidence, path.join(virtualStoreRoot, storeEntry.name, 'node_modules'));
    }
  }
  return evidence;
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`artifact must be a regular file: ${filePath}`);
    return crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function readRegularFile(filePath, encoding = 'utf8') {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`artifact must be a regular file: ${filePath}`);
    return fs.readFileSync(descriptor, encoding);
  } finally {
    fs.closeSync(descriptor);
  }
}

function collectFloetermThemeNotices() {
  const packageJSONPath = path.join(floetermThemePackageRoot, 'package.json');
  if (!fs.existsSync(packageJSONPath)) {
    throw new Error('installed @floegence/floeterm-terminal-web package is required to generate or verify notices');
  }
  const packageJSON = readJSON(packageJSONPath);
  if (packageJSON.version !== floetermThemeArtifactContract.packageVersion) {
    throw new Error(`floeterm theme notice contract requires ${floetermThemeArtifactContract.packageVersion}, found ${packageJSON.version ?? 'missing'}`);
  }
  for (const [relativePath, expectedHash] of Object.entries(floetermThemeArtifactContract.files)) {
    const artifactPath = path.join(floetermThemePackageRoot, relativePath);
    if (!fs.existsSync(artifactPath)) throw new Error(`floeterm theme notice artifact is missing: ${relativePath}`);
    const actualHash = sha256File(artifactPath);
    if (actualHash !== expectedHash) {
      throw new Error(`floeterm theme notice artifact hash mismatch for ${relativePath}: expected ${expectedHash}, got ${actualHash}`);
    }
  }
  return {
    version: packageJSON.version,
    artifactHashes: Object.values(floetermThemeArtifactContract.files),
    noticeText: fs.readFileSync(path.join(floetermThemePackageRoot, 'THIRD_PARTY_THEME_NOTICES.md'), 'utf8').trim(),
    solarizedLicenseText: fs.readFileSync(path.join(floetermThemePackageRoot, 'third_party_licenses/solarized-MIT.txt'), 'utf8').trim(),
    tokyoNightLicenseText: fs.readFileSync(path.join(floetermThemePackageRoot, 'third_party_licenses/tokyonight-Apache-2.0.txt'), 'utf8').trim(),
  };
}

function collectTerminalAgentIconAssets() {
  const manifest = readJSON(terminalAgentIconManifestPath);
  if (manifest.schema_version !== 2) throw new Error('terminal agent icon manifest schema_version must be 2');
  const approvedSources = new Map([
    ['thesvg', {
      repository: 'https://github.com/GLINCKER/thesvg',
      licenseFile: 'assets/licenses/thesvg-MIT.txt',
    }],
    ['pi', {
      repository: 'https://github.com/earendil-works/pi-website',
      licenseFile: 'assets/licenses/pi-website-MIT.txt',
    }],
  ]);
  const sourceEntries = Object.entries(manifest.sources ?? {});
  if (JSON.stringify(sourceEntries.map(([key]) => key)) !== JSON.stringify([...approvedSources.keys()])) {
    throw new Error('terminal agent icon sources must exactly match the approved source registry');
  }
  const sources = new Map(sourceEntries.map(([key, source]) => {
    const approved = approvedSources.get(key);
    if (!approved || source?.repository !== approved.repository) {
      throw new Error(`terminal agent icon source is not approved: ${key}`);
    }
    if (!/^[0-9a-f]{40}$/u.test(String(source.revision ?? ''))) {
      throw new Error(`terminal agent icon source revision must be a pinned Git commit: ${key}`);
    }
    if (source.license !== 'MIT') throw new Error(`terminal agent icon source license must be MIT: ${key}`);
    if (source.license_file !== approved.licenseFile) {
      throw new Error(`terminal agent icon source license path is not approved: ${key}`);
    }
    const licensePath = path.resolve(repoRoot, source.license_file);
    if (!licensePath.startsWith(`${repoRoot}${path.sep}`) || !fs.statSync(licensePath).isFile()) {
      throw new Error(`terminal agent icon license file is missing or outside the repository: ${key}`);
    }
    const label = String(source.label ?? '').trim();
    if (!label) throw new Error(`terminal agent icon source label is missing: ${key}`);
    return [key, { ...source, label, licensePath }];
  }));
  const defaultSourceKey = String(manifest.default_source ?? '');
  if (!sources.has(defaultSourceKey)) throw new Error('terminal agent icon default source is invalid');

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const identities = assets.map((asset) => String(asset?.identity ?? ''));
  if (JSON.stringify(identities) !== JSON.stringify(expectedTerminalAgentIconIdentities)) {
    throw new Error(`terminal agent icon identities must exactly match the approved registry: ${expectedTerminalAgentIconIdentities.join(', ')}`);
  }

  const seenFiles = new Set();
  const rows = assets.map((asset) => {
    const sourceKey = String(asset.source ?? defaultSourceKey);
    const source = sources.get(sourceKey);
    if (!source) throw new Error(`terminal agent icon references an unknown source: ${sourceKey}`);
    const file = String(asset.file ?? '');
    const sourcePath = String(asset.source_path ?? '');
    if (!/^[a-z-]+\.svg$/u.test(file)) {
      throw new Error(`terminal agent icon filename is invalid or duplicated: ${file}`);
    }
    if (!/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*\.svg$/u.test(sourcePath)
      || sourcePath.split('/').some(segment => segment === '.' || segment === '..')) {
      throw new Error(`terminal agent icon source path is invalid: ${sourcePath}`);
    }
    if (asset.render !== 'image' && asset.render !== 'mask') {
      throw new Error(`terminal agent icon render mode is invalid: ${asset.render}`);
    }
    const bundledFiles = [{
      file,
      sourcePath,
      sha256: asset.sha256,
      upstreamSha256: asset.upstream_sha256,
      modified: asset.modified,
    }];
    const hasLightVariant = asset.light_file != null
      || asset.light_source_path != null
      || asset.light_sha256 != null
      || asset.light_upstream_sha256 != null
      || asset.light_modified != null;
    const hasDarkVariant = asset.dark_file != null
      || asset.dark_source_path != null
      || asset.dark_sha256 != null
      || asset.dark_upstream_sha256 != null
      || asset.dark_modified != null;
    if (hasLightVariant !== hasDarkVariant) {
      throw new Error(`terminal agent icon theme variants must be supplied as a light/dark pair: ${file}`);
    }
    if (hasLightVariant) {
      bundledFiles.push(
        {
          file: String(asset.light_file),
          sourcePath: String(asset.light_source_path),
          sha256: asset.light_sha256,
          upstreamSha256: asset.light_upstream_sha256,
          modified: asset.light_modified,
        },
        {
          file: String(asset.dark_file),
          sourcePath: String(asset.dark_source_path),
          sha256: asset.dark_sha256,
          upstreamSha256: asset.dark_upstream_sha256,
          modified: asset.dark_modified,
        },
      );
    }
    for (const variant of bundledFiles) {
      if (!/^[a-z-]+\.svg$/u.test(variant.file) || seenFiles.has(variant.file)) {
        throw new Error(`terminal agent icon variant filename is invalid or duplicated: ${variant.file}`);
      }
      if (!/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*\.svg$/u.test(variant.sourcePath)
        || variant.sourcePath.split('/').some(segment => segment === '.' || segment === '..')) {
        throw new Error(`terminal agent icon variant source path is invalid: ${variant.sourcePath}`);
      }
      const bundledPath = path.join(terminalAgentIconRoot, variant.file);
      if (!fs.existsSync(bundledPath)) throw new Error(`terminal agent icon is missing: ${variant.file}`);
      verifyBundledIconIntegrity({
        filePath: bundledPath,
        bundledSha256: variant.sha256,
        upstreamSha256: variant.upstreamSha256,
        modified: variant.modified,
      });
      seenFiles.add(variant.file);
    }
    return {
      label: String(asset.label ?? ''),
      license: source.license,
      source: bundledFiles.map((variant) => {
        const variantName = path.basename(variant.sourcePath, '.svg');
        const url = `${source.repository}/blob/${source.revision}/${variant.sourcePath}`;
        return `[${variantName}](${url})`;
      }).join('<br>'),
      file: bundledFiles.map((variant) => `\`internal/envapp/ui_src/public/agent-cli-icons/${variant.file}\``).join('<br>'),
      modified: asset.modified === false ? 'No' : 'Trailing newline only',
    };
  });

  const bundledFiles = fs.readdirSync(terminalAgentIconRoot).filter((file) => file.endsWith('.svg')).sort();
  const declaredFiles = [...seenFiles].sort();
  if (JSON.stringify(bundledFiles) !== JSON.stringify(declaredFiles)) {
    throw new Error('bundled terminal agent SVG files must exactly match the audited manifest');
  }

  return {
    rows,
    licenseNotices: [...sources.values()].map(source => ({
      label: source.label,
      license: source.license,
      text: readRegularFile(source.licensePath, 'utf8').trim(),
    })),
  };
}

function normalizeLicense(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'UNKNOWN';
  return text.replace(/\s+/g, ' ');
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

function collectJavaScriptEntries() {
  const entries = new Map();

  const inventory = collectJavaScriptLockInventory(javascriptLockSources.map((source) => ({
    label: source.label,
    packageLock: source.packageLock ? readJSON(path.join(repoRoot, source.packageLock)) : undefined,
    pnpmLock: source.pnpmLock
      ? parseYAML(fs.readFileSync(path.join(repoRoot, source.pnpmLock), 'utf8'))
      : undefined,
  })));
  assertPlatformFilteredLicensesResolvable(inventory, {
    packageOverrides: npmLicenseOverrides,
    coordinateOverrides: npmCoordinateLicenseOverrides,
  });
  const installedLicenseEvidence = collectInstalledJavaScriptLicenseEvidence();

  for (const pkg of inventory) {
    const coordinate = packageCoordinate(pkg.name, pkg.version);
    const resolution = resolvePackageLicense(
      {
        ...pkg,
        licenses: [...pkg.licenses, ...(installedLicenseEvidence.get(coordinate) ?? [])],
      },
      {
        packageOverrides: npmLicenseOverrides,
        coordinateOverrides: npmCoordinateLicenseOverrides,
      },
    );
    const license = normalizeLicense(resolution.license);
    const notes = [...resolution.notes];
    if (license.includes('GPL') && /\bMIT\b/.test(license)) {
      notes.push('Redeven uses this dual-licensed package under the MIT option.');
    }

    mergeEntry(entries, {
      key: `npm:${coordinate}`,
      ecosystem: 'npm',
      name: pkg.name,
      version: pkg.version,
      license,
      source: `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}/v/${encodeURIComponent(pkg.version)}`,
      scopes: pkg.scopes,
      notes,
    });
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
  return String(value ?? '').replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
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

function renderTerminalAgentIconTable(rows) {
  const lines = [
    '| Brand asset | License | Pinned source | Bundled file | Modification |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.license} | ${row.source} | ${row.file} | ${row.modified} |`);
  }
  return lines.join('\n');
}

function renderTerminalAgentIconLicenses(notices) {
  return notices.map(notice => `### ${notice.label} ${notice.license} License

\`\`\`text
${notice.text}
\`\`\``).join('\n\n');
}

function renderNotices(goEntries, npmEntries, terminalAgentIcons, floetermThemeNotices) {
  return `# Third-Party Notices

Generated by \`scripts/generate_third_party_notices.mjs\`.

Redeven itself is licensed under the MIT License; see \`LICENSE\`.

This inventory is intentionally broad: it includes Go modules used by the runtime and JavaScript packages used to build the embedded Env App, Code App, and Desktop shell. Some JavaScript packages are build-time only, but keeping them in one auditable notice file avoids accidental omission when build output changes.

## Go Modules

${renderTable(goEntries)}

## JavaScript Packages

${renderTable(npmEntries)}

## Bundled Agent CLI Brand Assets

The following icons are redistributed from pinned upstream revisions. Product names and marks remain the property of their respective owners. These assets are used only to identify the corresponding Agent CLI process in the terminal session list.

${renderTerminalAgentIconTable(terminalAgentIcons.rows)}

${renderTerminalAgentIconLicenses(terminalAgentIcons.licenseNotices)}

## Floeterm Built-in Theme Notices

Redeven embeds the built-in terminal theme catalog from \`@floegence/floeterm-terminal-web@${floetermThemeNotices.version}\`. The following attribution and license texts are reproduced in Redeven's distributed root notice from the installed registry package. Notice generation verifies the upstream provenance, quality evidence, notice, and license artifacts against these fixed SHA-256 values before emitting this section:

${floetermThemeNotices.artifactHashes.map((hash) => `- \`${hash}\``).join('\n')}

${floetermThemeNotices.noticeText}

### Solarized MIT License

\`\`\`text
${floetermThemeNotices.solarizedLicenseText}
\`\`\`

### Tokyo Night Apache-2.0 License

\`\`\`text
${floetermThemeNotices.tokyoNightLicenseText}
\`\`\`

## Desktop Runtime Notices

Redeven Desktop packages Electron and Chromium runtime components. Desktop release artifacts include Electron's \`LICENSE\` and \`LICENSES.chromium.html\` files under \`licenses/electron/\` in addition to this notice file.

## License Policy Guard

The generator fails on missing licenses and on licenses that are not acceptable for Redeven's public binary and desktop distribution without explicit review, including AGPL, GPL-only, LGPL, SSPL, BUSL, Commons Clause, Elastic License, and PolyForm-style licenses.
`;
}

const goEntries = collectGoEntries();
const npmEntries = collectJavaScriptEntries();
const terminalAgentIcons = collectTerminalAgentIconAssets();
const floetermThemeNotices = collectFloetermThemeNotices();
const allEntries = [...goEntries, ...npmEntries];
const violations = policyViolations(allEntries);
if (violations.length > 0) {
  console.error('Third-party license policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

const nextContent = renderNotices(goEntries, npmEntries, terminalAgentIcons, floetermThemeNotices);
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
