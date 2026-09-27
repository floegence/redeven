#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageComputerResources } from './stage_computer_resources.mjs';

export function verifyGoTests(body, required = []) {
  const events = body.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(!events.some(event => ['skip', 'fail'].includes(event.Action)), 'Required Go qualification contains a skipped or failed test');
  const passed = events.filter(event => event.Action === 'pass' && event.Test).map(event => event.Test);
  assert(passed.length > 0, 'Go qualification executed zero tests');
  for (const test of required) assert(passed.includes(test), `Required test did not pass: ${test}`);
  return passed.length;
}

export function verifyBrowserTests(body) {
  const report = JSON.parse(body);
  assert(report.success === true && report.numPassedTests > 0, 'Browser qualification did not execute passing tests');
  assert.equal(report.numPendingTests, 0, 'Browser qualification contains skipped tests');
  assert.equal(report.numTodoTests, 0, 'Browser qualification contains unfinished tests');
  assert.equal(report.numFailedTests, 0, 'Browser qualification contains failures');
  assert(report.testResults.length > 0 && report.testResults.every(file => file.status === 'passed' && file.assertionResults.length > 0), 'A required browser test file failed to load or executed zero tests');
  return report.numPassedTests;
}

export function verifyNodeTests(body) {
  const count = name => {
    const matches = [...body.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    assert.equal(matches.length, 1, `Missing or ambiguous Node test summary: ${name}`);
    return Number(matches[0][1]);
  };
  const passed = count('pass');
  assert(passed > 0 && count('tests') === passed, 'Node qualification must execute passing tests');
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0, `Node qualification contains ${name} tests`);
  return passed;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ui = path.join(root, 'internal/envapp/ui_src');
  const archive = process.env.REDEVEN_BROWSER_TEST_PACKAGE;
  const installation = process.env.REDEVEN_BROWSER_TEST_INSTALLATION;
  assert(archive && path.isAbsolute(archive) && installation && path.isAbsolute(installation),
    'Set REDEVEN_BROWSER_TEST_PACKAGE to the original catalog archive and REDEVEN_BROWSER_TEST_INSTALLATION to an explicitly qualified installed package; build the Env App first');
  const catalog = JSON.parse(await readFile(path.join(root, 'internal/browserinstall/catalog.json'), 'utf8'));
  const architecture = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  const pkg = catalog.packages.find(pkg => pkg.platform === process.platform && pkg.architecture === architecture);
  assert(pkg, 'Native browser catalog package unavailable');
  assert.equal((await stat(archive)).size, pkg.size_bytes, 'Archive size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest('hex'), pkg.sha256, 'Archive digest mismatch');
  assert.equal(await readFile(path.join(installation, '.redeven-browser'), 'utf8'), pkg.sha256, 'Installed package marker mismatch');
  const executable = path.join(installation, pkg.executable);
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  assert(version.status === 0 && version.stdout.includes(pkg.version), 'Installed browser version mismatch');
  const evidence = process.env.REDEVEN_BROWSER_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'redeven-browser-qualification-'));
  await mkdir(evidence, { recursive: true });
  const staging = await mkdtemp(path.join(evidence, 'helpers-'));
  const resources = path.join(staging, 'computer');
  stageComputerResources(resources);
  const helperArchive = path.join(staging, 'computer.zip');
  assert.equal(spawnSync('python3', ['-c', 'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])', helperArchive.slice(0, -4), resources]).status, 0, 'Unable to archive staged product helpers');
  const env = { ...process.env, GOWORK: 'off', REDEVEN_BROWSER_INTEGRATION: '1', REDEVEN_BROWSER_SOURCE: 'managed', REDEVEN_BROWSER_ARCHIVE: archive, REDEVEN_COMPUTER_ARCHIVE: helperArchive, REDEVEN_BROWSER_TEST_EXECUTABLE: executable };
  const results = [];
  async function run(name, command, args, cwd, environment, verify) {
    console.log(`[browser] ${name}`);
    const result = spawnSync(command, args, { cwd, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    await writeFile(path.join(evidence, `${name}.log`), result.stdout + result.stderr);
    assert.equal(result.status, 0, `${name} failed; see ${path.join(evidence, `${name}.log`)}\n${result.stderr.slice(-3000)}`);
    const count = await verify(result.stdout);
    results.push({ name, count });
    console.log(`[browser] ${name}: ${count} tests passed, zero skipped`);
  }
  await run('runtime', 'go', ['test', './internal/ai', '-parallel=1', '-run', '^TestBrowser|^TestExtension|^TestManagedBrowser|^TestComputer(MissingBrowser|FullAccessManagedBrowser|AutonomousManaged|AutonomousProductionToolLoop|NavigationFailureContinuesProductionTurn)', '-count=1', '-json'], root, env,
    body => verifyGoTests(body, ['TestBrowserRecoveryRebuildsOnceAndPreservesSavedTabs', 'TestBrowserRecoveryDoesNotReviveFlowerInitialTarget', 'TestBrowserDirectoryBeforeUnloadKeepsOtherWorkspaceCommandsUsable', 'TestBrowserInputSaturationDoesNotRetireHealthyView', 'TestManagedBrowserRequestCancellationPreservesProcessAndResponseOrder', 'TestManagedBrowserForegroundPopupSelectsOnlyItsInputOwner', 'TestComputerNavigationFailureContinuesProductionTurn']));
  await run('storage-installation', 'go', ['test', './internal/browserinstall', './internal/browserstore', './internal/browserbridge', '-count=1', '-json'], root, env, verifyGoTests);
  await run('api', 'go', ['test', './internal/codeapp/appserver', '-run', '^TestBrowser(WorkspaceFailure|ViewAPI|Library)', '-count=1', '-json'], root, env,
    body => verifyGoTests(body, ['TestBrowserWorkspaceFailureActionsAndRecoveryAuthorization']));
  const bridgeBinary = path.join(staging, 'redeven');
  const bridgeBuild = spawnSync('go', ['build', '-o', bridgeBinary, './cmd/redeven'], { cwd: root, env, encoding: 'utf8' });
  await writeFile(path.join(evidence, 'native-bridge-build.log'), bridgeBuild.stdout + bridgeBuild.stderr);
  assert.equal(bridgeBuild.status, 0, 'Unable to build the real Native Messaging bridge');
  await run('managed-launch', process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'scripts/computerManagedLaunch.node-test.mjs'], ui, env, verifyNodeTests);
  // Browser contexts and native-host registrations are process-wide on some
  // Chromium builds. Keep this qualification lane serial so one test cannot
  // race another context's extension worker or native host lookup.
  await run('chrome-extension', process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'scripts/computerExtensionLifecycle.node-test.mjs', 'scripts/computerExtensionPopup.node-test.mjs', 'scripts/computerExtension.node-test.mjs'], ui, env, verifyNodeTests);
  // Native Messaging is a browser-process boundary. Run it in its own Node
  // process so Chrome cannot retain an extension worker from another fixture
  // while the disposable host manifest is being exercised.
  await run('native-messaging', process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'scripts/computerNativeMessaging.node-test.mjs'], ui, { ...env, REDEVEN_BROWSER_BRIDGE_BINARY: bridgeBinary }, verifyNodeTests);
  for (const [name, args] of [
    ['ui-unit', ['src/browserDocument.test.ts', 'src/ui/services/browserWorkspaceController.test.ts', 'src/ui/services/browserSourcePort.test.ts', 'src/ui/services/browserWindow.test.ts', 'src/ui/services/browserWorkspaceWindows.test.ts', 'src/ui/widgets/FloeBrowserSurface.test.tsx', 'src/ui/pages/EnvBrowserPage.test.tsx']],
    ['ui-browser', ['--config', 'vitest.browser.config.ts', 'src/browserDocument.browser.test.tsx', 'src/ui/widgets/BrowserSourceDialog.browser.test.tsx', 'src/ui/FlowerManagedBrowser.browser.test.tsx', 'src/ui/FlowerComputerConnections.browser.test.tsx']],
  ]) {
    const report = path.join(evidence, `${name}.json`);
    await run(name, 'pnpm', ['exec', 'vitest', 'run', ...args, '--reporter=json', `--outputFile=${report}`], ui, env, async () => verifyBrowserTests(await readFile(report, 'utf8')));
  }
  for (const [source, client] of [['managed', 'chrome'], ['managed', 'electron'], ['extension', 'chrome']]) {
    await run(`projection-${source}-${client}`, 'go', ['test', './internal/codeapp/appserver', '-run', '^TestBrowserProjectionUsesOneFlowersecSession$', '-count=1', '-json'], root,
      { ...env, REDEVEN_BROWSER_SOURCE: source, REDEVEN_BROWSER_CLIENT: client, REDEVEN_BROWSER_DEBUG_EVIDENCE: path.join(evidence, `projection-${source}-${client}.json`) },
      body => verifyGoTests(body, ['TestBrowserProjectionUsesOneFlowersecSession']));
  }
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ commit: git(['rev-parse', 'HEAD']), sourceDiffSHA256: createHash('sha256').update(git(['diff', 'HEAD', '--binary'])).digest('hex'), dependency: JSON.parse(await readFile(path.join(ui, 'package.json'), 'utf8')).dependencies['@floegence/floebrowser'], package: pkg.id, results }, null, 2) + '\n');
  console.log(`[browser] evidence: ${evidence}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
