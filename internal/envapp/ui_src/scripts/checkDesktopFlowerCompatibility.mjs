/* global window */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This mutates only the explicitly supplied qualification Runtime: first prove
// old-runtime isolation, then use Desktop's real update action and re-probe.
assert.equal(process.env.REDEVEN_FLOWER_COMPATIBILITY_E2E, '1');
const cdp = process.env.REDEVEN_DESKTOP_CDP;
const output = process.env.REDEVEN_COMPUTER_EVIDENCE_DIR;
assert(cdp && output && path.isAbsolute(output), 'task-owned Desktop CDP and evidence directory required');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const contract = JSON.parse(await readFile(path.join(root, 'internal/runtimeservice/compatibility_contract.json'), 'utf8'));
const browser = await chromium.connectOverCDP(cdp);
try {
  const page = browser.contexts()[0].pages().find(page => page.url() === new URL('desktop/dist/welcome/index.html', `file://${root}`).href);
  assert(page, 'CDP must identify this worktree Desktop');
  page.setDefaultTimeout(20000);
  await page.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
  await page.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'open_flower' }));
  const inspect = () => page.evaluate(async () => {
    const snapshot = await window.redevenDesktopLauncher.getSnapshot();
    const env = snapshot.environments.find(env => env.kind === 'local_environment');
    const runtime = env.runtime_service ?? env.local_environment_runtime_service;
    return { id: env.id, epoch: runtime.compatibility_epoch, version: runtime.runtime_version, commit: runtime.runtime_commit, protocol: runtime.protocol_version, openable: runtime.open_readiness?.state === 'openable' };
  });
  const before = await inspect();
  assert(before.epoch < contract.compatibility_epoch, 'fixture must start an actual old Runtime');
  assert(before.openable);
  const results = await page.evaluate(async () => {
    const request = window.redevenDesktopSettings.requestRuntimeFlower;
    return {
      read: await request({ method: 'GET', path: '/_redeven_proxy/api/settings' }),
      task: await request({ method: 'POST', path: '/_redeven_proxy/api/ai/threads', body: { title: 'Must not be admitted' } }),
      frame: await request({ method: 'GET', path: '/_redeven_proxy/api/ai/threads/not-created/computer-media/target/' + 'a'.repeat(64) }),
      privateFrame: await request({ method: 'GET', path: '/_redeven_proxy/api/ai/computer/private-frame?thread_id=not-created&observer_id=fixture&viewer_revision=1&interaction_id=fixture&frame_id=1' }),
      stream: await window.redevenDesktopSettings.startRuntimeFlowerStream({ stream_id: 'old-runtime-guard', path: '/_redeven_proxy/api/ai/flower/stream' }),
    };
  });
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, 'runtime_update_required', name);
  }
  const blocker = page.locator('[data-flower-runtime-blocker="runtime_update_required"]');
  await blocker.waitFor();
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'blocked.png') });
  const opened = await page.evaluate(id => window.redevenDesktopLauncher.performAction({ kind: 'open_local_environment', environment_id: id, route: 'local_host' }), before.id);
  assert(opened.ok, 'old Runtime Env App must remain independently openable');
  const deadline = Date.now() + 20000;
  let envPage;
  while (!(envPage = browser.contexts()[0].pages().find(value => value.url().includes('/_redeven_proxy/env/')))) {
    assert(Date.now() < deadline, 'Env App did not open');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await envPage.waitForLoadState('domcontentloaded');
  await envPage.locator('body').waitFor();
  await envPage.close();
  await blocker.getByRole('button', { name: 'Update', exact: true }).click();
  const updateDeadline = Date.now() + 60000;
  let after;
  do {
    after = await inspect();
    if (after.epoch === contract.compatibility_epoch) break;
    assert(Date.now() < updateDeadline, 'Runtime update did not reach the supported epoch');
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (after.epoch !== contract.compatibility_epoch);
  await blocker.waitFor({ state: 'detached' });
  assert.notEqual(after.commit, before.commit);
  const read = await page.evaluate(() => window.redevenDesktopSettings.requestRuntimeFlower({ method: 'GET', path: '/_redeven_proxy/api/settings' }));
  assert(read.ok, 'updated Runtime must pass the same Flower boundary');
  await writeFile(path.join(output, 'compatibility.json'), JSON.stringify({ before, after, requestsBlockedBeforeAdmission: true, streamsAndFramesBlocked: true, oldEnvAppOpened: true, existingUpdateActionVerified: true }, null, 2));
  console.log('Desktop rejected the old Runtime before Flower admission, kept Env App usable, and reverified the actual updated Runtime.');
} finally { await browser.close(); }
