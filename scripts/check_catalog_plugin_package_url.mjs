#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distributionPath = path.join(
  root,
  'internal/envapp/ui_src/src/ui/plugins/officialContainersDistribution.json',
);
const expectedRepository = 'floegence/redeven-official-plugins';
const expectedArtifactPath = 'official/containers/2.0.0/containers-2.0.0.redevplugin';
const expectedIconPath = 'plugins/containers/assets/containers-plugin.png';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

const distribution = JSON.parse(await readFile(distributionPath, 'utf8'));
assert.equal(distribution.repository, expectedRepository);
assert.match(distribution.commit, /^[0-9a-f]{40}$/u, 'catalog package URL must pin a full Git commit SHA');
assert.equal(distribution.artifact_path.join('/'), expectedArtifactPath);
assert.equal(distribution.icon_path.join('/'), expectedIconPath);
assert.match(distribution.artifact_sha256, /^[0-9a-f]{64}$/u, 'catalog artifact SHA-256 must be lowercase hex');
assert.match(distribution.icon_sha256, /^[0-9a-f]{64}$/u, 'catalog icon SHA-256 must be lowercase hex');

const repositoryURL = `https://github.com/${distribution.repository}.git`;
const catalogURL = `https://raw.githubusercontent.com/${distribution.repository}/${distribution.commit}/${expectedArtifactPath}`;
const iconURL = `https://raw.githubusercontent.com/${distribution.repository}/${distribution.commit}/${expectedIconPath}`;
for (const [value, expectedPath] of [[catalogURL, expectedArtifactPath], [iconURL, expectedIconPath]]) {
  const parsed = new URL(value);
  const segments = parsed.pathname.split('/').filter(Boolean);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'raw.githubusercontent.com');
  assert.equal(`${segments[0]}/${segments[1]}`, expectedRepository);
  assert.equal(segments[2], distribution.commit);
  assert.equal(segments.slice(3).join('/'), expectedPath);
}

const checkout = await mkdtemp(path.join(tmpdir(), 'redeven-official-plugins-'));
try {
  git(checkout, ['init', '--quiet']);
  git(checkout, ['remote', 'add', 'origin', repositoryURL]);
  git(checkout, ['fetch', '--quiet', '--depth', '1', 'origin', distribution.commit]);
  assert.equal(git(checkout, ['rev-parse', 'FETCH_HEAD']).trim(), distribution.commit);
  const artifact = git(checkout, ['show', `FETCH_HEAD:${expectedArtifactPath}`], { encoding: 'buffer' });
  const icon = git(checkout, ['show', `FETCH_HEAD:${expectedIconPath}`], { encoding: 'buffer' });
  assert.equal(sha256(artifact), distribution.artifact_sha256, 'pinned catalog artifact SHA-256 mismatch');
  assert.equal(sha256(icon), distribution.icon_sha256, 'pinned catalog icon SHA-256 mismatch');
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
  assert.equal(icon[25], 6, 'pinned catalog icon must retain alpha transparency');
} finally {
  await rm(checkout, { recursive: true, force: true });
}

process.stdout.write(`catalog package and icon verified: ${catalogURL}\n`);
