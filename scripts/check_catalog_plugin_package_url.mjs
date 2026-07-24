#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distributionPath = path.join(
  root,
  'internal/envapp/ui_src/src/ui/plugins/officialContainersDistribution.json',
);
const expectedRepository = 'floegence/redeven';
const expectedArtifactPath = 'spec/redevplugin/catalog-containers-plugin/2.0.0/plugin.redevplugin';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

const distribution = JSON.parse(await readFile(distributionPath, 'utf8'));
assert.equal(distribution.repository, expectedRepository);
assert.match(distribution.commit, /^[0-9a-f]{40}$/u, 'catalog package URL must pin a full Git commit SHA');
assert.ok(Array.isArray(distribution.artifact_path), 'catalog artifact_path must be an array');
const artifactPath = distribution.artifact_path.join('/');
assert.equal(artifactPath, expectedArtifactPath);
assert.match(distribution.artifact_sha256, /^[0-9a-f]{64}$/u, 'catalog artifact SHA-256 must be lowercase hex');
const catalogURL = `https://raw.githubusercontent.com/${distribution.repository}/${distribution.commit}/${artifactPath}`;

const parsedURL = new URL(catalogURL);
const segments = parsedURL.pathname.split('/').filter(Boolean);
assert.equal(parsedURL.protocol, 'https:');
assert.equal(parsedURL.hostname, 'raw.githubusercontent.com');
assert.equal(`${segments[0]}/${segments[1]}`, expectedRepository);
const commit = segments[2];
assert.equal(commit, distribution.commit);
assert.equal(segments.slice(3).join('/'), artifactPath);

const workingTreeArtifact = await readFile(path.join(root, artifactPath));
assert.equal(sha256(workingTreeArtifact), distribution.artifact_sha256, 'working-tree catalog artifact SHA-256 changed');

let commitAvailable = true;
try {
  git(['cat-file', '-e', `${commit}^{commit}`]);
} catch {
  commitAvailable = false;
}

let pinnedArtifact;
if (commitAvailable) {
  try {
    git(['merge-base', '--is-ancestor', commit, 'HEAD']);
  } catch {
    throw new Error(`catalog package URL commit ${commit} is not an ancestor of HEAD`);
  }
  pinnedArtifact = git(['show', `${commit}:${artifactPath}`], { encoding: 'buffer' });
} else {
  const response = await fetch(catalogURL, { redirect: 'error' });
  assert.equal(response.status, 200, `catalog package URL returned HTTP ${response.status}`);
  pinnedArtifact = Buffer.from(await response.arrayBuffer());
}

assert.equal(sha256(pinnedArtifact), distribution.artifact_sha256, 'pinned catalog artifact SHA-256 mismatch');
assert.deepEqual(pinnedArtifact, workingTreeArtifact, 'pinned and working-tree catalog artifacts differ');

process.stdout.write(`catalog package URL verified: ${catalogURL}\n`);
