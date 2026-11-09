/* global document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { createDesktopTestSession } from '../../../../scripts/desktop_test_session.mjs';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
  const output = path.resolve(process.env.REDEVEN_GIT_INTERACTION_REPORT ?? 'node_modules/.cache/git-interaction-electron');
  await mkdir(output, { recursive: true });
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-git-interaction-')));
  const tls = await createBuiltDistTLS();
  await session.directory(tls.directory);
  const server = await createBuiltDistServer({ accessReady: true, gitReady: true, visualWorkspace: true, tls, renewPeerOnConnect: true });
  await session.defer('Git built renderer fixture', () => server.close());
  await session.port(new URL(server.baseURL).port);
  const report = {
    status: 'running', target: 'built Env App renderer in isolated native Electron',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    floe: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url), 'utf8')).version,
    theme: process.env.REDEVEN_GIT_INTERACTION_THEME ?? 'dark',
    sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
    cases: [], errors: [],
  };
  const main = path.join(state, 'main.cjs');
  await writeFile(main, `const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:1000,useContentSize:true,show:true,webPreferences:{contextIsolation:true,sandbox:true}});win.loadURL('about:blank');});`);
  const app = await session.launchElectron(_electron, {
    executablePath: desktopRequire('electron'), cwd: state,
    args: [main, `--user-data-dir=${state}/profile`, `--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const screenshot = async name => {
    const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await trustBuiltDistWebTransport(page, tls);
  await page.addInitScript(theme => {
    localStorage.setItem('redeven-envapp:env_local-activity-navigation', JSON.stringify({ version: 1, target: { kind: 'builtin', page: 'files' }, recentBuiltins: ['files', 'terminal'] }));
    localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    localStorage.setItem('redeven_ui_language_preference', 'zh-CN');
    localStorage.setItem('redeven-envapp:env_local-theme', JSON.stringify(theme));
  }, report.theme);
  try {
    await page.goto(`${server.baseURL}_redeven_proxy/env/`);
    const mode = page.locator('[data-browser-mode-switch]');
    await mode.waitFor();
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), report.theme === 'dark');
    await mode.getByRole('radio', { name: 'Git', exact: true }).click();
    await page.locator('[data-git-commit-summary]').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-git-commit-summary]')?.textContent.includes('+232'));
    const draft = page.locator('[data-git-commit-draft]');
    assert.match(await draft.textContent(), /待提交 3 个文件/);
    assert.match(await draft.textContent(), /\+232/);
    assert.match(await draft.textContent(), /−60/);
    assert.equal(await draft.getByRole('button').textContent(), '提交');
    await draft.locator('textarea').fill('fix: preserve git review state');
    const collapse = page.getByRole('button', { name: '折叠所有目录', exact: true });
    assert.equal(await collapse.isDisabled(), true);
    await page.locator('[data-git-all-section="changes"] [data-git-tree-select="src"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-git-all-section="changes"] [data-git-tree-select]').length > 2);
    assert.equal(await collapse.isEnabled(), true);
    assert.equal(await page.locator('[data-git-all-scroll]').evaluate(el => el.scrollWidth > el.clientWidth), true);
    await collapse.click();
    assert.equal(await collapse.isDisabled(), true);
    await screenshot(`changes-zh-${report.theme}`);
    report.cases.push('whole-index summary, explicit commit, collapsed lazy tree, horizontal scrolling');
    const nav = page.locator('[data-git-workspace-navigation]');
    await page.locator('[data-git-all-section="changes"] [data-git-tree-select="src"]').click();
    await page.locator('[data-git-all-section="staged"] [data-git-tree-select="src"]').click();
    await page.locator('[data-git-all-section="staged"] [data-git-tree-select="src/staged-0.ts"]').waitFor();
    const retained = page.locator('[data-git-all-section="changes"] [data-git-tree-select*="LongComponentName"]');
    await retained.click();
    await page.locator('.git-patch-viewer__viewport:visible').waitFor();
    for (const section of ['changes', 'staged']) {
      const source = page.locator(`[data-git-all-section="${section}"] [data-git-tree-path="src/feature-0.ts"]`);
      await source.waitFor();
      const frames = await source.evaluate(async (row, section) => {
        const leaf = document.querySelector('[data-git-all-section="changes"] [data-git-tree-select*="LongComponentName"]');
        const root = document.querySelector('[data-git-all-section="changes"] [data-git-tree-select="src"]');
        const viewport = document.querySelector('[data-git-all-scroll]');
        const patch = document.querySelector('.git-patch-viewer__viewport');
        viewport.scrollLeft = 100;
        const beforeLeft = viewport.scrollLeft;
        row.querySelector('.git-workspace-tree__actions button').click();
        const samples = [];
        for (let frame = 0; frame < 70; frame++) {
          samples.push({ leaf: leaf.isConnected, root: root.isConnected, viewport: viewport.isConnected,
            patch: patch.isConnected, skeletons: viewport.querySelectorAll('[data-git-content-skeleton]').length,
            left: viewport.scrollLeft, beforeLeft });
          await new Promise(requestAnimationFrame);
        }
        return { section, samples };
      }, section);
      assert.ok(frames.samples.every(frame => frame.leaf && frame.root && frame.viewport && frame.patch && !frame.skeletons && frame.left === frame.beforeLeft), JSON.stringify(frames));
      const destination = section === 'changes' ? 'staged' : 'changes';
      await page.locator(`[data-git-all-section="${destination}"] [data-git-tree-select="src/feature-0.ts"]`).waitFor();
      assert.equal(await draft.locator('textarea').inputValue(), 'fix: preserve git review state');
      report.cases.push(frames);
    }
    await screenshot(`retained-stage-unstage-${report.theme}`);

    for (const label of ['已暂存', '变更', '全部']) {
      await page.getByRole('radio', { name: label, exact: true }).click();
      const overlay = await page.getByRole('radio', { name: label, exact: true }).evaluate(button => {
        const rail = button.closest('.floe-segmented-control');
        return {
          labels: rail.querySelectorAll('.floe-segmented-control__ink-label').length,
          hidden: rail.querySelector('.floe-segmented-control__pill')?.getAttribute('aria-hidden'),
        };
      });
      assert.equal(overlay.labels, 4, 'published shared selection keeps clipped label ink');
      assert.equal(overlay.hidden, 'true', 'decorative labels stay out of accessible names');
      assert.equal(await draft.locator('textarea').inputValue(), 'fix: preserve git review state');
      assert.match(await draft.textContent(), /\+232/);
    }
    await nav.getByRole('tab', { name: '分支', exact: true }).click();
    await page.locator('[data-git-sidebar-branch-key]').first().click();
    await page.locator('[data-git-branch-status-content-frame] [data-git-tree-select="src"]:visible').waitFor();
    assert.equal(await page.locator('[data-git-branch-status-content-frame] .git-paged-footer__button-skeleton').count(), 0);
    await screenshot(`branch-workspace-${report.theme}`);
    const branchPanel = page.locator('[data-testid="git-main-subview-branches"]');
    await branchPanel.getByRole('tab', { name: '提交图', exact: true }).click();
    await branchPanel.locator('[data-commit-graph-row]').first().click();
    await page.locator('[data-git-branch-commit-files-surface="inline"] [data-git-tree-select="src"]:visible').click();
    await page.locator('[data-git-branch-commit-files-surface="inline"] [data-git-tree-select="src/feature-0.ts"]:visible').click();
    await page.locator('.git-patch-viewer__viewport:visible').waitFor();
    for (const width of [1440, 1000]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1000), width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const dimensions = await page.locator('.git-diff-panel__toolbar:visible').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return [...el.querySelectorAll('button')].map(button => { const box = button.getBoundingClientRect(); return { height: box.height, contained: box.top >= rect.top && box.bottom <= rect.bottom, label: button.textContent }; });
      });
      assert.ok(dimensions.every(item => item.height <= 32 && item.contained), JSON.stringify(dimensions));
      await screenshot(`branch-commit-diff-${width}`);
      report.cases.push({ width, diffControls: dimensions });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
    for (const source of ['branches', 'history', 'stashes']) {
      if (source === 'history') {
        await nav.getByRole('tab', { name: '提交图', exact: true }).click();
        await page.locator('[data-testid="git-main-subview-history"]:visible').waitFor();
      }
      if (source === 'stashes') {
        await nav.getByRole('tab', { name: '储藏', exact: true }).click();
        await page.locator('[data-git-stash-embedded]:visible').waitFor();
        const geometry = await nav.evaluate(el => [...el.querySelectorAll('[role="tab"]')].map(tab => tab.getBoundingClientRect().bottom));
        assert.equal(geometry.length, 4);
        assert.ok(geometry.every(bottom => Math.abs(bottom - geometry[0]) < 1));
        await page.waitForFunction(() => {
          const active = document.querySelector('[data-git-workspace-navigation] [role="tab"][aria-selected="true"]');
          const indicator = document.querySelector('.git-workspace-view-indicator');
          if (active?.dataset.floeTabId !== 'stashes' || !indicator) return false;
          const tab = active.getBoundingClientRect(), line = indicator.getBoundingClientRect();
          return Math.abs(tab.x - line.x) < 1 && Math.abs(tab.width - line.width) < 1 && Math.abs(tab.bottom - line.bottom) < 1;
        });
        const emptyCard = page.getByText('暂无储藏', { exact: true }).locator('..').locator('..');
        await emptyCard.waitFor();
        const cardBounds = await emptyCard.boundingBox();
        const toolbarBounds = await page.locator('[data-git-stash-toolbar]:visible').boundingBox();
        const stashCardGap = cardBounds.y - toolbarBounds.y - toolbarBounds.height;
        assert.ok(stashCardGap >= 12, `Empty stash card gap: ${stashCardGap}px`);
        report.cases.push({ stashCardGap });
        await screenshot(`stashes-${report.theme}`);
      }
      const samples = await nav.getByRole('tab', { name: '变更', exact: true }).evaluate(async button => {
        button.click(); const frames = [];
        for (let i = 0; i < 10; i++) {
          frames.push([...document.querySelectorAll('[data-testid^="git-main-subview-"]')].filter(el => el.checkVisibility({ checkVisibilityCSS: true })).map(el => el.dataset.testid));
          await new Promise(requestAnimationFrame);
        }
        return frames;
      });
      assert.ok(samples.every(frame => !frame.includes('git-main-subview-history') && !frame.includes('git-main-subview-branches')), JSON.stringify({ source, samples }));
      await draft.waitFor();
      assert.equal(await draft.locator('textarea').inputValue(), 'fix: preserve git review state');
      assert.equal(await mode.isVisible(), true);
      report.cases.push({ source, transitionFrames: samples });
    }
    await draft.getByRole('button', { name: '提交', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await screenshot('commit-confirmation');
    report.cases.push('commit still requires staged-index review');
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (error) {
    await screenshot('failure');
    report.status = 'failed'; report.failure = String(error.stack ?? error); throw error;
  } finally {
    await session.writeEvidence(path.join(output, 'report.json'), report);
  }
});
