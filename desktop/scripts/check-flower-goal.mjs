import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(root, 'desktop/dist/flower-goal-acceptance');
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  await mkdir(output, { recursive: true });
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-flower-goal-'));
  await session.directory(state);
  const server = await createSSHSettingsPreviewServer(0, ['flower-navigation.html']);
  await session.defer('preview server', () => server.close());
  await session.port(new URL(server.resolvedUrls.local[0]).port);
  await server.watcher.close();
  const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
    marker: randomUUID(), state, url: server.resolvedUrls.local[0], errors: [], cases: [], status: 'running' };
  await session.writeEvidence(path.join(output, 'report.json'), report);
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, `const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => { const win = new BrowserWindow({ width: 1100, height: 850, useContentSize: true,
      webPreferences: { contextIsolation: true, sandbox: true } }); win.loadURL('about:blank'); });`);
  const application = await session.launchElectron(_electron, { executablePath: electron,
    args: [entry, '--user-data-dir=' + state + '/profile', '--redeven-smoke-run=' + report.marker],
    cwd: state, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  report.pid = application.process().pid;
  const page = application.context().pages()[0] ?? await application.context().waitForEvent('page');
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(path.join(root, 'desktop/src/testSupport/mixedEnvironmentFixture.ts'));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(path.join(root, 'desktop/src/shared/runtimeService.ts'));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => ({ ...entry, runtime_service: {
    ...(entry.runtime_service ?? entry.local_environment_runtime_service), compatibility_epoch: epoch, protocol_version: protocol,
    compatibility: 'compatible', open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' },
  } }));
  for (const locale of ['en-US', 'zh-CN']) {
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.addInitScript(({ snapshot, locale }) => {
      window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('flower-navigation.html?goal=1', report.url).href);
    assert.ok(page.url().endsWith('flower-navigation.html?goal=1'));
    await page.getByRole('button', { name: 'Flower', exact: true }).click();
    await page.evaluate(() => window.navigationFixture.releaseRuntime());
    await page.locator('[data-thread-id="navigation-thread"] button').first().click();
    const trigger = page.locator('.flower-goal-tag'), input = page.locator('.flower-goal-input');
    const labels = locale === 'zh-CN' ? { save: '保存目标', resume: '继续编辑', replace: '替换当前目标', retry: '重试' }
      : { save: 'Save goal', resume: 'Continue editing', replace: 'Replace current goal', retry: 'Try again' };
    const capture = async state => { await page.locator('.flower-goal-popup').screenshot({ path: path.join(output, locale + '-' + state + '.png') }); };
    await trigger.click(); await input.waitFor();
    assert.equal(await input.inputValue(), 'Confirm the release and preserve every requirement.');
    assert.equal(await page.getByRole('button', { name: labels.save, exact: true }).count(), 0);
    await capture('current'); await page.keyboard.press('Escape');
    await page.evaluate(() => { window.navigationFixture.publishGoal('Fresh goal from the runtime', false); window.navigationFixture.holdGoalReads = true; });
    await trigger.click(); await page.locator('.flower-goal-loading').waitFor();
    assert.equal(await input.count(), 0); await capture('loading');
    await page.evaluate(() => { window.navigationFixture.holdGoalReads = false; window.navigationFixture.releaseGoalRead(); });
    await input.waitFor(); assert.equal(await input.inputValue(), 'Fresh goal from the runtime');
    await input.fill('My carefully retained draft'); await page.keyboard.press('Escape');
    await page.evaluate(() => window.navigationFixture.publishGoal('Updated by the model'));
    await trigger.click(); await input.waitFor();
    assert.equal(await input.inputValue(), 'Updated by the model');
    assert.equal(await input.getAttribute('readonly'), ''); await capture('draft-current');
    await page.getByRole('button', { name: labels.resume, exact: true }).click();
    assert.equal(await input.inputValue(), 'My carefully retained draft'); await capture('replace');
    await page.getByRole('button', { name: labels.replace, exact: true }).click();
    await page.locator('.flower-goal-popup').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.navigationFixture.goalRequests.map(({ operation, expected_version, text }) => ({ operation, expected_version, text }))),
      [{ operation: 'set', expected_version: 3, text: 'My carefully retained draft' }]);
    await page.evaluate(() => { window.navigationFixture.holdGoalReads = true; });
    await trigger.click(); await page.locator('.flower-goal-loading').waitFor();
    await page.evaluate(() => { window.navigationFixture.holdGoalReads = false; window.navigationFixture.releaseGoalRead(true); });
    await page.locator('.flower-goal-popup [role="alert"]').waitFor(); await capture('error');
    assert.equal(await page.locator('.flower-thread-sync-error').count(), 0);
    await page.locator('.flower-goal-popup').getByRole('button', { name: labels.retry, exact: true }).click(); await input.waitFor();
    assert.equal(await input.inputValue(), 'My carefully retained draft');
    await page.keyboard.press('Escape');
    const entryLayouts = [];
    const editor = page.locator('.flower-composer textarea');
    const settle = () => page.evaluate(async () => {
      await document.fonts.ready;
      for (let index = 0; index < 4; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    });
    for (const width of [1100, 430]) {
      await page.setViewportSize({ width, height: 850 });
      await editor.fill(''); await settle();
      await page.evaluate(() => {
        const composer = document.querySelector('.flower-composer');
        const footer = composer.querySelector('.flower-composer-footer');
        const transcript = document.querySelector('.flower-chat-transcript');
        const geometry = () => [composer.getBoundingClientRect().top, composer.getBoundingClientRect().height,
          footer.getBoundingClientRect().top, transcript.getBoundingClientRect().height, transcript.scrollTop, window.scrollY];
        const capture = window.goalEntryLayout = { initial: geometry(), samples: [], active: true };
        const sample = () => { if (capture.active) { capture.samples.push(geometry()); requestAnimationFrame(sample); } };
        requestAnimationFrame(sample);
      });
      await editor.fill('/goal'); await editor.press('Space'); await settle();
      assert.equal(await editor.inputValue(), '');
      assert.equal(await editor.getAttribute('placeholder'), locale === 'zh-CN' ? '设置目标' : 'Set a goal');
      const alignment = await editor.evaluate(element => {
        const chip = document.querySelector('.flower-goal-command-chip');
        const style = getComputedStyle(element), rect = element.getBoundingClientRect(), chipRect = chip.getBoundingClientRect();
        return { offset: Math.abs(chipRect.top + chipRect.height / 2 - rect.top - parseFloat(style.paddingTop)
          - parseFloat(style.borderTopWidth) - parseFloat(style.lineHeight) / 2),
        fontSize: style.fontSize, chipFontSize: getComputedStyle(chip).fontSize };
      });
      assert.ok(alignment.offset <= 1, JSON.stringify(alignment));
      assert.equal(alignment.chipFontSize, alignment.fontSize);
      await page.locator('.flower-composer').screenshot({ path: path.join(output, locale + '-entry-' + width + '.png') });
      await editor.fill('Verify result'); await settle(); await editor.press('Escape'); await settle();
      const layout = await page.evaluate(() => {
        const capture = window.goalEntryLayout;
        capture.active = false;
        return { drift: Math.max(...capture.samples.flatMap(sample => sample.map((value, index) => Math.abs(value - capture.initial[index])))),
          samples: capture.samples.length };
      });
      assert.ok(layout.samples > 0 && layout.drift <= 1, JSON.stringify(layout));
      await editor.fill('/goal '); await settle();
      assert.equal(await editor.inputValue(), '');
      await editor.press('Backspace');
      assert.equal(await page.locator('.flower-goal-command-chip').count(), 0);
      entryLayouts.push({ width, ...alignment, ...layout, pastedCommandCleared: true });
    }
    report.cases.push({ locale, freshConfirmation: true, currentFirst: true, reviewedReplacement: true, saveOnly: true, localFailure: true, entryLayouts });
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  await session.writeEvidence(path.join(output, 'report.json'), report);
});
