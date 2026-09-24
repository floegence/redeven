/* global document, window, getComputedStyle, requestAnimationFrame, cancelAnimationFrame */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';

const output = path.resolve(process.env.REDEVEN_MOBILE_NAVIGATION_REPORT ?? 'node_modules/.cache/mobile-navigation');
await mkdir(output, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createBuiltDistServer({ accessReady: true, gitReady: true, fileContinuity: true, tls, renewPeerOnConnect: true,
  handleRequest: async (_request, response, url) => {
    if (url.pathname === '/__fixture/files/1010') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ agent_home_path_abs: '/workspace', home_path_abs: '/workspace', default_root_id: 'home', roots: [{ id: 'home', label: 'Workspace', path_abs: '/workspace', kind: 'home', permissions: { read: true, write: true } }] }));
      return true;
    }
    if (url.pathname === '/__fixture/files/1001') {
      let body = ''; for await (const chunk of _request) body += chunk;
      const directory = JSON.parse(body).path;
      const names = directory === '/workspace' ? ['src', 'assets'] : directory === '/workspace/src' ? ['components'] : [];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ entries: names.map(name => ({ name, path: `${directory}/${name}`, is_directory: true, entry_type: 'folder', resolved_type: 'folder', size: 0, modified_at: 1, created_at: 1 })) }));
      return true;
    }
    if (url.pathname !== '/__mobile-navigation') return false;
    const surface = ['terminal', 'files'].includes(url.searchParams.get('surface')) ? url.searchParams.get('surface') : 'ai';
    const locale = url.searchParams.get('locale') ?? 'zh-CN';
    const preferences = {
      'redeven-envapp:env_local-activity-navigation': JSON.stringify({ version: 1, target: { kind: 'builtin', page: surface }, recentBuiltins: [surface, 'terminal'] }),
      redeven_envapp_desktop_view_mode: 'activity',
      redeven_ui_language_preference: locale,
      'floe-theme': url.searchParams.get('theme') ?? 'light',
    };
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<script>for (const [key,value] of Object.entries(${JSON.stringify(preferences)})) localStorage.setItem(key,value); location.replace('/_redeven_proxy/env/');</script>`);
    return true;
  },
});
const fixture = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, port: Number(new URL(server.baseURL).port), baseURL: server.baseURL,
  certificatePath: tls.certificatePath, statePath: tls.directory, output,
};
await writeFile(path.join(output, 'runtime.json'), JSON.stringify(fixture, null, 2));
if (process.env.REDEVEN_MOBILE_NAVIGATION_SERVE === '1') {
  console.log(JSON.stringify(fixture));
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  await server.close(); await tls.cleanup();
} else {
  const results = [];
  const failures = [];
  const settle = async page => page.waitForFunction(() => [...document.getAnimations()].every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished'));
  const geometry = async locator => locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, radius: getComputedStyle(element).borderTopLeftRadius };
  });
  const assertBounds = (rect, viewport) => {
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1, JSON.stringify(rect));
  };
  const startDrawerFrames = page => page.evaluate(() => {
    window.__drawerFrames = [];
    const sample = () => {
      const panel = document.querySelector('.flower-mobile-thread-drawer');
      window.__drawerFrames.push({
        headerTop: document.querySelector('.flower-chat-header').getBoundingClientRect().top,
        pageScroll: document.querySelector('.ai-readiness-boundary').scrollTop,
        documentScroll: document.scrollingElement.scrollTop,
        opacity: panel ? Number(getComputedStyle(panel).opacity) : null,
      });
      window.__drawerFrameId = requestAnimationFrame(sample);
    };
    sample();
  });
  const finishDrawerFrames = async (page, label) => {
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__drawerFrameId);
      return window.__drawerFrames;
    });
    await writeFile(path.join(output, `${label}-motion.json`), JSON.stringify(frames, null, 2));
    assert.ok(frames.some(frame => frame.opacity !== null && frame.opacity < 1), `${label}: sampled drawer motion`);
    assert.ok(frames.every(frame => Math.abs(frame.headerTop - frames[0].headerTop) < 1 && frame.pageScroll === 0 && frame.documentScroll === 0), `${label}: drawer motion displaced the retained page`);
  };
  try {
    for (const name of (process.env.REDEVEN_MOBILE_NAVIGATION_BROWSERS ?? 'chromium,webkit').split(',')) {
      const browser = await ({ chromium, webkit })[name].launch({ args: name === 'chromium' ? [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] : [] });
      try {
        for (const viewport of [{ width: 320, height: 700 }, { width: 393, height: 740 }, { width: 430, height: 740 }, { width: 767, height: 740 }, { width: 667, height: 390 }].filter(size => !process.env.REDEVEN_MOBILE_NAVIGATION_WIDTH || size.width === Number(process.env.REDEVEN_MOBILE_NAVIGATION_WIDTH))) {
          const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, hasTouch: true, isMobile: true });
          const page = await context.newPage();
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          page.setDefaultTimeout(15000);
          await page.addInitScript(({ width, height }) => {
            const visibleViewport = Object.assign(new EventTarget(), { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: visibleViewport });
            window.__setNavigationViewport = (size) => {
              Object.assign(visibleViewport, size);
              visibleViewport.dispatchEvent(new Event('resize'));
            };
          }, viewport);
          await trustBuiltDistWebTransport(page, tls);
          const prefix = `${name}-${viewport.width}x${viewport.height}`;
          let stage = 'flower navigation';
          try {
            await page.goto(`${server.baseURL}__mobile-navigation?theme=${viewport.width === 430 ? 'dark' : 'light'}`);
            const editor = page.locator('.flower-composer textarea');
            await editor.waitFor();
            await page.locator('.flower-empty-suggestion').first().waitFor();
            await settle(page);
            assert.equal(await page.locator('[data-floe-shell-slot="top-bar"]:visible').count(), 0, 'mobile shell must reclaim the framework header');
            const cards = page.locator('.flower-empty-suggestion');
            const first = await geometry(cards.nth(0)); const second = await geometry(cards.nth(1));
            assert.ok(Math.abs(first.y - second.y) < 1 && second.x > first.right);
            await page.screenshot({ path: path.join(output, `${prefix}-suggestions.png`) });
            await editor.fill('Retained draft 中文');
            await editor.evaluate(element => { window.__drawerEditor = element; element.setSelectionRange(2, 7); });
            const tab = page.getByRole('tab', { name: 'Flower', exact: true });
            await startDrawerFrames(page);
            await tab.tap();
            const drawer = page.locator('.flower-mobile-thread-drawer');
            await drawer.waitFor(); await settle(page);
            const flower = await geometry(drawer); assertBounds(flower, viewport);
            assert.equal(await tab.getAttribute('aria-expanded'), 'true');
            assert.equal(await page.locator('.flower-component-main').evaluate(element => element.inert), true);
            assert.ok(!['INPUT', 'TEXTAREA'].includes(await page.evaluate(() => document.activeElement?.tagName)));
            const newChat = drawer.locator('.flower-new-chat-button');
            const newChatBounds = await geometry(newChat);
            const newChatIcon = await geometry(newChat.locator('svg'));
            assert.ok(Math.abs(newChatBounds.x + newChatBounds.width / 2 - newChatIcon.x - newChatIcon.width / 2) < 1);
            await page.screenshot({ path: path.join(output, `${prefix}-flower.png`) });
            await tab.tap(); await drawer.waitFor({ state: 'detached' });
            await finishDrawerFrames(page, `${prefix}-tab`);
            assert.equal(await editor.evaluate(element => element === window.__drawerEditor), true);
            assert.equal(await editor.inputValue(), 'Retained draft 中文');
            assert.deepEqual(await editor.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 7]);
            await startDrawerFrames(page);
            await page.locator('.flower-chat-header .flower-mobile-navigation-button').tap();
            await drawer.waitFor(); await settle(page);
            await drawer.press('Escape'); await drawer.waitFor({ state: 'detached' });
            await finishDrawerFrames(page, `${prefix}-header`);
            const plugins = page.locator('[aria-controls="redeven-plugin-switcher"]:visible');
            stage = 'plugin navigation';
            await plugins.click();
            const pluginDrawer = page.locator('.plugin-mobile-launcher-drawer');
            await pluginDrawer.waitFor(); await settle(page);
            const plugin = await geometry(pluginDrawer); assertBounds(plugin, viewport);
            const navigation = page.locator('[data-floe-shell-slot="mobile-tab-bar"]');
            const navigationBounds = await geometry(navigation);
            assert.ok(plugin.bottom <= navigationBounds.y - 7, 'plugin drawer must end above bottom navigation');
            assert.equal(await plugins.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return !element.closest('[inert]') && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            }), true, 'plugin trigger must receive real pointer input');
            await plugins.tap(); await pluginDrawer.waitFor({ state: 'detached' });
            await plugins.tap(); await pluginDrawer.waitFor(); await settle(page);
            assert.ok(plugin.y >= 24 && parseFloat(plugin.radius) >= 20);
            assert.ok(!['INPUT', 'TEXTAREA'].includes(await page.evaluate(() => document.activeElement?.tagName)));
            await page.screenshot({ path: path.join(output, `${prefix}-plugins.png`) });
            assert.equal(await pluginDrawer.getAttribute('aria-modal'), null);
            assert.equal(await page.locator('[data-floe-shell-slot="main-layout"]').evaluate(element => element.inert), true);
            const search = page.locator('[data-plugin-launcher-search]:visible');
            assert.ok((await geometry(search)).height >= 44);
            assert.ok(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 16);
            await search.fill('Retained plugin query');
            await page.evaluate(() => window.__setNavigationViewport({ height: 280, offsetTop: 12 }));
            await page.waitForFunction(() => document.querySelector('[data-floe-shell-slot="mobile-tab-bar"]').getBoundingClientRect().bottom <= 293);
            assert.equal(await navigation.isVisible(), true, 'panel search keeps bottom navigation above the keyboard');
            assert.ok((await geometry(pluginDrawer)).bottom <= (await geometry(navigation)).y - 7);
            await search.evaluate(element => element.blur());
            await page.evaluate(height => window.__setNavigationViewport({ height, offsetTop: 0 }), viewport.height);
            await plugins.tap(); await pluginDrawer.waitFor({ state: 'detached' });
            await plugins.tap(); await pluginDrawer.waitFor();
            assert.equal(await search.inputValue(), 'Retained plugin query');
            await search.press('Escape'); assert.equal(await search.inputValue(), '');
            await plugins.evaluate(element => { element.click(); element.click(); });
            await settle(page);
            assert.equal(await page.locator('[data-floe-mobile-navigation-overlay]').count(), 1, 'reversed close keeps one overlay');
            const more = page.getByRole('button', { name: '更多', exact: true });
            stage = 'tools pages';
            const moreBounds = await geometry(more);
            await more.tap();
            const tools = page.locator('.mobile-tools-drawer');
            await tools.waitFor(); await settle(page);
            assert.equal(await pluginDrawer.count(), 0);
            assert.ok((await geometry(tools)).bottom <= (await geometry(navigation)).y - 7);
            await page.screenshot({ path: path.join(output, `${prefix}-tools.png`) });
            await page.locator('[data-mobile-tool="downloads"]').tap();
            await page.locator('.mobile-download-tasks').waitFor();
            await tools.press('Escape');
            await page.locator('[data-mobile-tool="language"]').tap();
            await page.locator('[data-envapp-language-menu="inline"]').waitFor();
            await page.locator('[data-envapp-language-option="en-US"]').tap();
            await page.waitForFunction(() => document.documentElement.lang === 'en-US');
            await page.locator('[data-envapp-language-option="zh-CN"]').tap();
            await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
            await tools.press('Escape');
            await page.locator('[data-mobile-tool="appearance"]').tap();
            await page.locator('[data-envapp-theme-menu="inline"]').waitFor();
            await tools.locator('[id$="-mode-dark"]').tap();
            await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
            await page.waitForFunction(() => !document.querySelector('[data-envapp-theme-menu="inline"] [aria-busy="true"]'));
            await settle(page);
            await page.screenshot({ path: path.join(output, `${prefix}-appearance.png`) });
            await tools.press('Escape');
            assert.equal(await tools.locator('.mobile-shell-tools > div').evaluate(element => element.scrollTop), 0);
            await tools.locator('.mobile-shell-tools [data-floe-autofocus]').evaluate(element => element.blur());
            await page.screenshot({ path: path.join(output, `${prefix}-tools-dark.png`) });
            await plugins.tap(); await pluginDrawer.waitFor(); await settle(page);
            await page.screenshot({ path: path.join(output, `${prefix}-plugins-dark.png`) });
            await more.tap(); await tools.waitFor();
            await tools.locator('[data-mobile-tool="appearance"]').tap();
            await tools.locator('[id$="-mode-light"]').tap();
            await page.waitForFunction(() => document.documentElement.classList.contains('light'));
            await page.waitForFunction(() => !document.querySelector('[data-envapp-theme-menu="inline"] [aria-busy="true"]'));
            await tools.press('Escape');
            await tools.locator('[data-mobile-tool="dashboard"]').focus();
            await page.keyboard.press('Tab');
            assert.equal(await navigation.evaluate(element => element.contains(document.activeElement)), true);
            await more.focus();
            await page.keyboard.press('Tab');
            assert.equal(await tools.evaluate(element => element.contains(document.activeElement)), true);
            stage = 'close tools';
            await more.tap(); await tools.waitFor({ state: 'detached' });
            stage = 'search handoff';
            await more.tap(); await tools.waitFor();
            await page.locator('[data-mobile-tool="search"]').tap();
            await tools.waitFor({ state: 'detached' });
            const commandInput = page.locator('.floe-floating-dialog-panel input:visible');
            await commandInput.waitFor();
            await page.waitForFunction(() => document.activeElement?.matches('.floe-floating-dialog-panel input'));
            await commandInput.press('Escape');
            await commandInput.waitFor({ state: 'detached' });
            stage = 'notes handoff';
            await more.tap(); await tools.waitFor();
            await page.locator('[data-mobile-tool="notes"]').tap();
            await tools.waitFor({ state: 'detached' });
            const notes = page.locator('.notes-overlay');
            await notes.waitFor();
            await notes.locator('[data-floe-overlay-close="true"]').tap();
            await notes.waitFor({ state: 'detached' });
            stage = 'plugin focus restoration';
            await plugins.tap(); await pluginDrawer.waitFor();
            assert.ok(Math.abs((await geometry(more)).x - moreBounds.x) < 1, 'More stays fixed while tabs scroll');
            await pluginDrawer.press('Escape'); await pluginDrawer.waitFor({ state: 'detached' });
            await page.waitForFunction(() => document.activeElement?.getAttribute('aria-controls') === 'redeven-plugin-switcher');
            assert.equal(await page.locator('[data-floe-shell-slot="main-layout"]').evaluate(element => element.inert), false);
            assert.equal(await editor.evaluate(element => element === window.__drawerEditor), true);
            assert.equal(await editor.inputValue(), 'Retained draft 中文');
            stage = 'responsive retention';
            await more.tap(); await tools.waitFor();
            await page.setViewportSize({ width: 768, height: 800 });
            await page.evaluate(() => window.__setNavigationViewport({ width: 768, height: 800 }));
            await page.locator('[data-floe-shell-slot="top-bar"]').waitFor();
            await tools.waitFor({ state: 'detached' });
            assert.equal(await editor.evaluate(element => element === window.__drawerEditor), true);
            await page.setViewportSize(viewport);
            await page.evaluate(size => window.__setNavigationViewport(size), viewport);
            await more.waitFor();
            assert.equal(await page.locator('[data-floe-shell-slot="top-bar"]').count(), 0);
            for (const item of await navigation.getByRole('tab').all()) {
              await item.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }));
              await page.waitForFunction(label => {
                const element = [...document.querySelectorAll('[data-floe-shell-slot="mobile-tab-bar"] [role="tab"]')]
                  .find(item => item.getAttribute('aria-label') === label);
                if (!element) return false;
                const rect = element.getBoundingClientRect();
                return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
              }, await item.getAttribute('aria-label'));
            }
            stage = 'page navigation';
            await more.tap(); await tools.waitFor();
            const terminalTab = page.getByRole('tab', { name: '终端', exact: true });
            await terminalTab.tap();
            await tools.waitFor({ state: 'detached' });
            const terminal = page.locator('[data-terminal-mobile-drawer][role="dialog"]');
            await terminal.waitFor(); await settle(page);
            assert.equal(await terminalTab.getAttribute('aria-expanded'), 'true');
            assert.equal(await page.getByRole('group', { name: 'Mobile terminal keyboard', exact: true }).isVisible(), false);
            const terminalBounds = await geometry(terminal); assertBounds(terminalBounds, viewport);
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'terminal-session-drawer-close');
            assert.equal(await page.locator('[data-testid="terminal-session-filter"]').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 16);
            await page.screenshot({ path: path.join(output, `${prefix}-terminal.png`) });
            await terminalTab.tap();
            await terminal.waitFor({ state: 'hidden' });
            assert.equal(await terminalTab.getAttribute('aria-expanded'), 'false');
            await terminalTab.tap();
            await terminal.waitFor(); await settle(page);
            await terminal.press('Escape');
            await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.getAttribute('aria-expanded') === 'false');
            assert.equal(await page.getByRole('group', { name: 'Mobile terminal keyboard', exact: true }).isVisible(), false);
            const filesTab = page.getByRole('tab', { name: '文件浏览器', exact: true });
            await filesTab.tap();
            const closeTree = page.getByRole('button', { name: '关闭侧边栏', exact: true });
            await closeTree.waitFor();
            const workspaceRow = page.locator('[data-tree-row-path="/workspace"]');
            await workspaceRow.waitFor();
            await workspaceRow.locator('..').getByRole('button', { name: '展开文件夹', exact: true }).tap();
            for (const directory of ['/workspace/src', '/workspace/src/components']) {
              const entry = page.locator(`[data-tree-row-path="${directory}"]`);
              await entry.tap();
              await page.waitForFunction(path => document.querySelector(`[data-tree-row-path="${path}"]`)?.getAttribute('aria-current') === 'page', directory);
              assert.equal(await closeTree.isVisible(), true, 'directory drawer stays open while navigating');
            }
            await page.screenshot({ path: path.join(output, `${prefix}-directories.png`) });
            await page.locator('[data-filesystem-root-id="home"] button').first().tap();
            await page.getByRole('radio', { name: 'Git', exact: true }).tap();
            await page.getByRole('tab', { name: '提交图', exact: true }).tap();
            const commit = page.locator('[data-commit-graph-row="abcdef1234567890"]');
            await commit.waitFor(); await commit.tap(); await settle(page);
            const changedFile = page.locator('.git-file-row').filter({ hasText: 'feature-1.ts' });
            await changedFile.waitFor();
            await page.screenshot({ path: path.join(output, `${prefix}-git-files.png`) });
            await changedFile.tap();
            const patch = page.locator('.git-diff-split__detail:visible .git-patch-viewer__viewport');
            await patch.waitFor(); await settle(page);
            const patchBounds = await geometry(patch);
            assert.ok(patchBounds.height >= viewport.height - 330, `mobile patch viewport is too short: ${patchBounds.height}`);
            await page.screenshot({ path: path.join(output, `${prefix}-git-diff.png`) });
            await page.locator('[data-git-diff-back]:visible').tap();
            assert.equal(await changedFile.isVisible(), true);
            stage = 'dashboard handoff';
            await more.tap(); await tools.waitFor();
            await page.route('**/dashboard', route => route.fulfill({ contentType: 'text/html', body: '<title>Dashboard fixture</title>' }));
            await tools.locator('[data-mobile-tool="dashboard"]').tap();
            await page.waitForURL('**/dashboard');
            assert.deepEqual(errors, []);
            results.push({ browser: name, viewport, flower, plugin, navigation: navigationBounds, more: moreBounds, terminal: terminalBounds, errors });
          } catch (error) {
            failures.push({ browser: name, viewport, stage, error: error.stack, errors });
            await page.screenshot({ path: path.join(output, `${prefix}-failure.png`) }).catch(() => {});
            console.error(JSON.stringify(failures.at(-1)));
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
  } finally {
    await server.close(); await tls.cleanup();
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2));
  }
  console.log(JSON.stringify({ passed: results.length, failures, output }));
  assert.equal(failures.length, 0, 'mobile navigation acceptance failed');
}
