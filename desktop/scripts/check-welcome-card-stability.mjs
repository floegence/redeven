import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/welcome-card-stability-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], state: server.config.cacheDir, output, cases: [], errors: [], failures: [] };
try {
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { buildDesktopWelcomeSnapshot } = await load('../src/main/desktopWelcomeState.ts');
  const { DesktopWelcomeRuntimeHealthStore, desktopWelcomeOnlineRuntimeHealth } = await load('../src/main/desktopWelcomeRuntimeHealth.ts');
  for (const linkKind of ['local_environment', 'ssh_environment']) {
    const { inputs } = mixedEnvironmentFixture({ linkKind });
    const store = new DesktopWelcomeRuntimeHealthStore(() => {});
    const targets = Object.values(inputs.managedRuntimePresenceByTargetID).map(presence => ({
      key: presence.target_id, environment_id: presence.environment_id,
      slot: presence.kind === 'local_environment' ? 'local_environment' : 'runtime_target', auto_refresh_enabled: true,
      checking_health: { status: 'offline', source: 'local_runtime_probe', checked_at_unix_ms: 0 },
      probe: async () => ({ presence, health: desktopWelcomeOnlineRuntimeHealth('local_runtime_probe', presence) }),
    }));
    await store.refresh(targets);
    const fresh = buildDesktopWelcomeSnapshot({ ...inputs, ...store.snapshot() });
    const owner = fresh.environments.find(entry => entry.provider_runtime_link_target?.provider_link_state === 'linked');
    const target = targets.find(target => target.environment_id === owner.id);
    let resolve;
    const refresh = store.refresh([{ ...target, probe: () => new Promise(done => { resolve = done; }) }], { force: true });
    const checking = buildDesktopWelcomeSnapshot({ ...inputs, ...store.snapshot() });
    resolve(await target.probe());
    await refresh;
    const settled = buildDesktopWelcomeSnapshot({ ...inputs, ...store.snapshot() });
    for (const locale of ['en-US', 'zh-CN']) {
      const context = await browser.newContext({ viewport: { width: 1367, height: 1000 }, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot: fresh, locale });
      await page.goto(new URL('environment-settings.html', report.url).href);
      await page.locator('[data-environment-group]').first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
      });
      const samples = await page.evaluate(async ({ checking, settled, ownerID }) => {
        const library = document.querySelector('.redeven-environment-library');
        const nodes = [...library.querySelectorAll('[data-environment-group]')];
        const read = label => ({ label, columns: getComputedStyle(library.querySelector('.redeven-environment-grid')).gridTemplateColumns,
          cards: [...library.querySelectorAll('[data-environment-group]')].map((card, index) => {
            const box = card.getBoundingClientRect();
            return { id: card.dataset.environmentGroup, sameNode: card === nodes[index], x: box.x, y: box.y, width: box.width, height: box.height };
          }) });
        const frames = [read('initial')];
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        let recording = true;
        const sampleFrames = async () => { while (recording) { await frame(); frames.push(read('open-frame')); } };
        const sampling = sampleFrames();
        let finishAction;
        const finishedAction = new Promise(resolve => { finishAction = resolve; });
        window.settingsFixture.beforeAction = async () => {
          for (const snapshot of [checking, settled]) {
            window.settingsFixture.publish(snapshot);
            frames.push(read(snapshot === checking ? 'checking' : 'settled'));
            await frame(); await frame();
          }
          finishAction();
        };
        library.querySelector(`[data-owner-id="${CSS.escape(ownerID)}"] .redeven-split-action-primary button`).click();
        await finishedAction;
        recording = false;
        await sampling;
        window.settingsFixture.beforeAction = undefined;
        return frames;
      }, { checking, settled, ownerID: owner.id });
      const navigation = await page.evaluate(async () => {
        const library = document.querySelector('.redeven-environment-library');
        const nodes = [...library.querySelectorAll('[data-environment-group]')];
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const read = label => ({ label, columns: getComputedStyle(library.querySelector('.redeven-environment-grid')).gridTemplateColumns,
          cards: [...library.querySelectorAll('[data-environment-group]')].map((card, index) => {
            const box = card.getBoundingClientRect();
            return { id: card.dataset.environmentGroup, sameNode: card === nodes[index], x: box.x, y: box.y, width: box.width, height: box.height };
          }) });
        const frames = [read('initial')];
        for (let cycle = 0; cycle < 2; cycle++) {
          document.querySelector('.redeven-flower-topbar-button').click();
          for (let i = 0; i < 4; i++) await frame();
          document.querySelector('.redeven-flower-back-button').click();
          frames.push(read('return-sync'));
          for (let i = 0; i < 35; i++) { await frame(); frames.push(read('return-frame')); }
        }
        return frames;
      });
      for (const [scenario, frames] of [['open-refresh', samples], ['return-to-environments', navigation]]) {
        const label = `${linkKind}:${locale}:${scenario}`;
        try {
          const baseline = frames[0];
          for (const sample of frames) {
            assert.equal(sample.columns, baseline.columns, `${label}:${sample.label}: columns`);
            assert.equal(sample.cards.length, baseline.cards.length, `${label}:${sample.label}: card count`);
            sample.cards.forEach((card, index) => {
              assert.equal(card.id, baseline.cards[index].id, `${label}: order`);
              assert.equal(card.sameNode, true, `${label}: DOM identity`);
              for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(
                Math.abs(card[dimension] - baseline.cards[index][dimension]) < 0.5,
                `${label}:${sample.label}:${card.id}:${dimension} ${baseline.cards[index][dimension]} -> ${card[dimension]}`);
            });
          }
          report.cases.push(label);
        } catch (error) { report.failures.push({ label, error: error.message, frames }); }
      }
      await page.screenshot({ path: `${output}/${linkKind}-${locale}.png` });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert.equal(report.failures.length, 0, report.failures.map(failure => failure.error).join('\n'));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error?.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 2));
