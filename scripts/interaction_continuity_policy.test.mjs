import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { runContinuity, continuityScope } from './check_interaction_continuity.mjs';
import { continuityAffected, continuityTests, continuityLocales, continuityViewports, continuityBrowserContracts, assertContinuityBrowserCoverage } from './interaction_continuity_contract.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('continuity has nonempty required behavior suites and propagates failures', () => {
  assert.deepEqual(Object.keys(continuityTests), ['state', 'client']);
  const required = ['desktopI18n', 'viewModel', 'desktopOverlayPosition', 'environmentLifecycleDisclosure', 'environmentGuidanceSession', 'environmentLibraryOverlayState', 'environmentSettingsSession', 'EnvironmentRelation', 'DesktopActionPopover', 'RuntimeCloudConnections', 'RuntimeGatewayJoinPanel', 'RuntimeGatewayConnectionsDialog', 'gatewaySourceOverlayState', 'RuntimeGatewaySetupDialog', 'EnvironmentSettingsEntry', 'EnvironmentSettingsDialog.accessibility', 'EnvironmentAccessSettingsForm', 'TwoFactorSettings', 'LocalCertificateSettings', 'GatewaySetup', 'GatewayMembersDialog', 'GatewayClientsPanel', 'GatewayCloudPanel'];
  const tests = Object.values(continuityTests).flat();
  assert.equal(tests.length, required.length);
  for (const name of required) assert.ok(tests.some(path => path.includes('/' + name + '.')), name);
  for (const path of tests) assert.ok(existsSync(new URL('../desktop/' + path, import.meta.url)), path);
  const runner = read('scripts/check_interaction_continuity.mjs');
  assert.match(runner, /tests\.length === 0/u);
  assert.match(runner, /if \(result\.status !== 0\) return result\.status \?\? 1/u);
  assert.doesNotMatch(runner, /passWithNoTests|catch\s*\{|\|\|\s*true/u);
});
test('continuity remains registered in cached commit and integration gates', () => {
  const groups = JSON.parse(read('scripts/local_gate_groups.json'));
  assert.ok(groups.profiles.commit.includes('interaction-continuity'));
  assert.deepEqual(groups.groups.find(group => group.id === 'interaction-continuity').command, ['node', 'scripts/check_interaction_continuity.mjs', '--staged']);
  assert.match(read('.githooks/pre-commit'), /local_gate\.py --profile commit --mode staged/u);
  assert.match(read('scripts/check_final_integration.sh'), /node "\$ROOT_DIR\/scripts\/check_interaction_continuity\.mjs"/u);
  for (const path of ['desktop/src/welcome/App.tsx', 'desktop/package.json', 'desktop/vitest.client.config.mts', 'internal/flower_ui/src/FlowerSurface.tsx', '.githooks/pre-commit', 'scripts/local_gate_groups.json']) assert.equal(continuityAffected(path), true, path);
});
test('browser qualification has one explicit local and manual workflow entry', () => {
  const scripts = JSON.parse(read('desktop/package.json')).scripts;
  assert.equal(scripts['test:interaction-continuity'], 'node ../scripts/check_interaction_continuity.mjs');
  assert.equal(scripts['test:interaction-continuity:browser'], 'node scripts/check-interaction-continuity.mjs');
  assert.match(read('scripts/check_desktop.sh'), /npm run test:interaction-continuity:browser/u);
  const workflow = read('.github/workflows/interaction-continuity.yml');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request):/mu);
  assert.match(workflow, /pnpm --dir desktop run test:interaction-continuity:browser/u);
  assert.match(workflow, /node desktop\/scripts\/check-settings-restart\.mjs/u);
  assert.match(read('scripts/check_quick_ci.sh'), /node --test scripts\/interaction_continuity_policy\.test\.mjs/u);
});

test('runner fails closed on missing tests, execution errors and nonzero status', () => {
  const suites = { state: ['a.test.ts'], client: ['b.test.tsx'] };
  let calls = 0;
  assert.equal(runContinuity({ suites, exists: () => true, execute: () => { calls++; return { status: 17 }; } }), 17);
  assert.equal(calls, 1);
  assert.equal(runContinuity({ suites, exists: () => true, execute: () => ({ status: null }) }), 1);
  assert.throws(() => runContinuity({ suites, exists: () => true, execute: () => ({ error: new Error('spawn failed') }) }), /spawn failed/u);
  for (const invalid of [{}, { state: [], client: ['b'] }, { state: ['a', 'a'], client: ['b'] }]) assert.throws(() => runContinuity({ suites: invalid }));
  assert.throws(() => runContinuity({ suites, exists: () => false }), /Missing continuity test/u);
});
test('scope uses exact staged or integration paths and fails closed on diff errors', () => {
  const diff = value => () => ({ status: 0, stdout: value });
  assert.equal(continuityScope(['--staged'], diff('desktop/src/welcome/App.tsx\0')), true);
  assert.equal(continuityScope(['--base','abc','--tip','def'], diff('README.md\0')), false);
  assert.throws(() => continuityScope(['--base','abc']), /Both continuity/u);
  assert.throws(() => continuityScope(['--staged'], () => ({ status: 1 })), /Cannot determine/u);
});

test('browser coverage fails closed on empty, incomplete and failed reports', () => {
  const report = { status: 'passed', errors: [], cases: continuityLocales.flatMap(locale => continuityViewports.map(viewport => ({ id: locale + '/' + viewport.width + 'x' + viewport.height, contracts: [...continuityBrowserContracts] }))) };
  assert.doesNotThrow(() => assertContinuityBrowserCoverage(report));
  assert.throws(() => assertContinuityBrowserCoverage({ ...report, cases: [] }));
  assert.throws(() => assertContinuityBrowserCoverage({ ...report, status: 'failed' }));
  assert.throws(() => assertContinuityBrowserCoverage({ ...report, errors: ['uncaught'] }));
  const incomplete = structuredClone(report); incomplete.cases[0].contracts.pop();
  assert.throws(() => assertContinuityBrowserCoverage(incomplete));
  assert.match(read('desktop/scripts/check-interaction-continuity.mjs'), /assertContinuityBrowserCoverage\(report\)/u);
});
