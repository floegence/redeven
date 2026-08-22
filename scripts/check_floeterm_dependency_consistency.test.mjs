import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateFloetermDependencies } from './check_floeterm_dependency_consistency.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeFixture() {
  const fixture = mkdtempSync(path.join(tmpdir(), 'redeven-floeterm-contract-'));
  for (const relativePath of ['go.mod', 'go.sum', 'THIRD_PARTY_NOTICES.md']) {
    cpSync(path.join(repoRoot, relativePath), path.join(fixture, relativePath));
  }
  const uiRoot = path.join(fixture, 'internal/envapp/ui_src');
  mkdirSync(path.join(uiRoot, 'node_modules/@floegence/floeterm-terminal-web'), { recursive: true });
  mkdirSync(path.join(fixture, 'okf/dist'), { recursive: true });
  for (const relativePath of ['package.json', 'package-lock.json', 'pnpm-lock.yaml']) {
    cpSync(path.join(repoRoot, 'internal/envapp/ui_src', relativePath), path.join(uiRoot, relativePath));
  }
  cpSync(
    path.join(repoRoot, 'internal/envapp/ui_src/node_modules/@floegence/floeterm-terminal-web/package.json'),
    path.join(uiRoot, 'node_modules/@floegence/floeterm-terminal-web/package.json'),
  );
  return fixture;
}

test('published Go and npm Floeterm dependencies use one released version', () => {
  assert.deepEqual(validateFloetermDependencies(), { version: '0.17.0' });
});

test('rejects a stale active terminal-web declaration', () => {
  const fixture = makeFixture();
  try {
    const packagePath = path.join(fixture, 'internal/envapp/ui_src/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies['@floegence/floeterm-terminal-web'] = '0.16.6';
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    assert.throws(() => validateFloetermDependencies(fixture), /must be 0\.17\.0/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects a local package-lock source', () => {
  const fixture = makeFixture();
  try {
    const lockPath = path.join(fixture, 'internal/envapp/ui_src/package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.packages['node_modules/@floegence/floeterm-terminal-web'].resolved = 'file:../../../../floeterm';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    assert.throws(() => validateFloetermDependencies(fixture), /public npm registry/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
