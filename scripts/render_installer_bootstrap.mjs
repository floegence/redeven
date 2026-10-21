#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const platforms = Object.freeze(['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64']);
const template = readFileSync(new URL('./installer_bootstrap.sh.in', import.meta.url), 'utf8');

export function renderBootstrap(version, digests, channel = 'github') {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('A canonical reviewed installer release tag is required');
  }
  if (!['github', 'portal'].includes(channel)) throw new Error('Unsupported official distribution channel');
  const values = {
    INSTALLER_VERSION: version,
    INSTALLER_CHANNEL: channel,
    INSTALLER_MIRROR: channel === 'portal' ? 'https://agent.package.redeven.com/agent-install-pkg' : '',
  };
  for (const platform of platforms) {
    if (!/^[a-f0-9]{64}$/.test(digests[platform] ?? '')) throw new Error(`Missing reviewed digest for ${platform}`);
    values[`SHA256_${platform.toUpperCase()}`] = digests[platform];
  }
  return template.replace(/@([A-Z0-9_]+)@/g, (_, name) => {
    if (!(name in values)) throw new Error(`Unresolved bootstrap value: ${name}`);
    return values[name];
  });
}

// Release packaging runs only on trusted build outputs. Consumers must first
// authenticate SHA256SUMS and match every downloaded file to its signed digest;
// they must not call this renderer on unverified or mutable downloaded inputs.
export function renderFromBuild(dist, version, channel = 'github') {
  const digests = {};
  for (const platform of platforms) {
    const file = path.join(dist, `redeven-installer_${platform}`);
    const info = lstatSync(file);
    if (!info.isFile() || info.size <= 0 || info.size > 64 * 1024 * 1024) throw new Error(`Invalid installer build: ${file}`);
    digests[platform] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return renderBootstrap(version, digests, channel);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--dist' || args[2] !== '--tag') {
      throw new Error('Usage: render_installer_bootstrap.mjs --dist <release-directory> --tag <vX.Y.Z>');
    }
    const dist = path.resolve(args[1]);
    for (const [channel, name] of [['github', 'redeven-install.sh'], ['portal', 'redeven-install-portal.sh']]) {
      writeFileSync(path.join(dist, name), renderFromBuild(dist, args[3], channel), { flag: 'wx', mode: 0o755 });
    }
    console.log(`[INFO] pinned bootstrap rendered from four real installer builds (${fileURLToPath(import.meta.url)})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
