#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogSourcePath = path.join(
  root,
  'internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts',
);
const builtDistSmokePath = path.join(
  root,
  'internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs',
);
const expectedArtifactSHA256 = '77986bc4b193ee1e5c60e596fb0c06ac7f9571cc78ea5d15abd646ab21176441';
const expectedRepository = 'floegence/redeven';

function extractRawPackageURL(source, label) {
  const matches = source.match(/https:\/\/raw\.githubusercontent\.com\/[^'"\s]+\/spec\/redevplugin\/catalog-containers-plugin\/[^'"\s]+\/plugin\.redevplugin/gu) ?? [];
  assert.equal(matches.length, 1, `${label} must contain exactly one immutable catalog package URL`);
  return matches[0];
}

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

const [catalogSource, builtDistSmoke] = await Promise.all([
  readFile(catalogSourcePath, 'utf8'),
  readFile(builtDistSmokePath, 'utf8'),
]);
const catalogURL = extractRawPackageURL(catalogSource, 'official plugin catalog');
assert.equal(
  extractRawPackageURL(builtDistSmoke, 'built-dist smoke'),
  catalogURL,
  'built-dist smoke and production catalog package URLs must match',
);

const parsedURL = new URL(catalogURL);
const segments = parsedURL.pathname.split('/').filter(Boolean);
assert.equal(parsedURL.protocol, 'https:');
assert.equal(parsedURL.hostname, 'raw.githubusercontent.com');
assert.equal(`${segments[0]}/${segments[1]}`, expectedRepository);
const commit = segments[2];
assert.match(commit, /^[0-9a-f]{40}$/u, 'catalog package URL must pin a full Git commit SHA');
const artifactPath = segments.slice(3).join('/');
assert.equal(
  artifactPath,
  'spec/redevplugin/catalog-containers-plugin/2.0.0/plugin.redevplugin',
);

const workingTreeArtifact = await readFile(path.join(root, artifactPath));
assert.equal(sha256(workingTreeArtifact), expectedArtifactSHA256, 'working-tree catalog artifact SHA-256 changed');

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

assert.equal(sha256(pinnedArtifact), expectedArtifactSHA256, 'pinned catalog artifact SHA-256 mismatch');
assert.deepEqual(pinnedArtifact, workingTreeArtifact, 'pinned and working-tree catalog artifacts differ');

process.stdout.write(`catalog package URL verified: ${catalogURL}\n`);
