import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function fixture(t, installed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-notices-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  for (const name of ['generate_third_party_notices.mjs', 'javascript_lock_inventory.mjs',
    'environment_platform_icon_integrity.mjs', 'flower_icon_integrity.mjs', 'terminal_agent_icon_integrity.mjs']) {
    write('scripts/' + name, fs.readFileSync(new URL(name, import.meta.url)));
  }
  const app = 'internal/envapp/ui_src/';
  write(app + 'package.json', JSON.stringify({ dependencies: { '@floegence/floe-webapp-core': '0.86.73' } }));
  // JSON is a YAML subset; keep the fixture independent of installed packages.
  write(app + 'node_modules/js-yaml/index.js', 'exports.load = JSON.parse;');
  write(app + 'pnpm-lock.yaml', JSON.stringify({ importers: { '.': { dependencies: {
    '@floegence/floe-webapp-core': { specifier: '0.86.73', version: '0.86.73(solid-js@1.9.17)' },
  } } } }));
  if (installed) write(app + 'node_modules/@floegence/floe-webapp-core/package.json', JSON.stringify(installed));
  write('THIRD_PARTY_NOTICES.md', 'existing notices\n');
  return { root, write, app };
}

for (const mode of [[], ['--check']]) {
  for (const installed of [undefined, { name: '@floegence/floe-webapp-core', version: '0.86.72' },
    { name: '@other/package', version: '0.86.73' }]) {
    test(`${mode.length ? 'checking' : 'generation'} rejects missing or stale Floe metadata: ${JSON.stringify(installed)}`, t => {
      const { root } = fixture(t, installed);
      const result = spawnSync(process.execPath, ['scripts/generate_third_party_notices.mjs', ...mode], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '', GOWORK: 'off' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Floe notice artifacts require installed @floegence\/floe-webapp-core@0\.86\.73/u);
      assert.match(result.stderr, /pnpm install --frozen-lockfile/u);
      assert.equal(fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'existing notices\n');
    });
  }
}

test('notice artifacts reject a manifest and lock mismatch before reading licenses', t => {
  const { root, write, app } = fixture(t, { name: '@floegence/floe-webapp-core', version: '0.86.73' });
  write(app + 'pnpm-lock.yaml', JSON.stringify({ importers: { '.': { dependencies: {
    '@floegence/floe-webapp-core': { specifier: '0.86.72', version: '0.86.72(solid-js@1.9.17)' },
  } } } }));
  const result = spawnSync(process.execPath, ['scripts/generate_third_party_notices.mjs', '--check'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '', GOWORK: 'off' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Floe notice artifacts require matching manifest and lock versions/u);
  assert.equal(fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'existing notices\n');
});
