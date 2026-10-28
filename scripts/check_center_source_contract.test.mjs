import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(path.join(root, name), 'utf8');

test('shared Center source cannot acquire host-specific authority', () => {
  const directory = path.join(root, 'desktop/src/envcenter');
  const sources = readdirSync(directory).filter(name => /\.tsx?$/.test(name));
  assert.ok(sources.length >= 4);
  for (const name of sources) {
    const source = readFileSync(path.join(directory, name), 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2]);
    for (const dependency of imports) {
      assert.ok(dependency.startsWith('./') || dependency === 'solid-js' || dependency.startsWith('@floegence/floe-webapp-core/'), name + ' imports host dependency ' + dependency);
    }
    assert.doesNotMatch(source, /redevenDesktopLauncher|window\.fetch|globalThis\.fetch|process\.env|document\.cookie|localStorage|sessionStorage/);
  }
});

test('both hosts consume the same Center implementation with independent adapters', () => {
  const desktop = read('desktop/src/welcome/App.tsx'), web = read('internal/envcenter_web/src/main.tsx');
  for (const source of [desktop, web]) {
    assert.match(source, /envcenter\/GatewayEnvironmentList/);
    assert.match(source, /envcenter\/controller/);
    assert.match(source, /createEnvironmentOpenController/);
  }
  assert.equal(existsSync(path.join(root, 'desktop/src/welcome/GatewayEnvironmentList.tsx')), false);
  assert.match(read('desktop/src/welcome/viewModel.ts'), /envcenter\/core/);
  assert.match(read('desktop/src/shared/desktopLauncherIPC.ts'), /selectEnvironmentSnapshot/);
  assert.doesNotMatch(read('desktop/src/welcome/envCenterAdapter.ts'), /api\/center|fetch\(|envcenter_web/);
  assert.doesNotMatch(read('internal/envcenter_web/src/adapter.ts'), /electron|redevenDesktopLauncher|node:/);
});

test('single-administrator wire API exposes no registration or user administration', () => {
  const contracts = read('internal/environmentcenter/contracts.go');
  assert.doesNotMatch(contracts, /"(?:register|users?|invitations?|organizations?|roles?|tenants?)(?:\/|")/);
  assert.ok(contracts.includes('"devices/revoke"'));
  assert.ok(contracts.includes('"setup/commit"'));
});

test('routine Center checks remain bounded while explicit browser qualification stays opt-in', () => {
  const checks = read('scripts/check_center.sh');
  assert.match(checks, /center-contracts --check/);
  assert.match(checks, /check_center_source_contract\.test\.mjs/);
  assert.match(checks, /--contracts-only/);
  const gate = read('scripts/check_final_integration.sh');
  assert.match(gate, /check_center\.sh"? --contracts-only/);
  assert.doesNotMatch(gate, /check_center\.sh --browser/);
});
