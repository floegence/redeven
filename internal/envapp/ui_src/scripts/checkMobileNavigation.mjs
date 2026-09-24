/* global document, window, getComputedStyle, requestAnimationFrame, cancelAnimationFrame */
import assert from 'node:assert/strict';
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
const fixture = { pid: process.pid, baseURL: server.baseURL, certificatePath: tls.certificatePath, output };
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
          await trustBuiltDistWebTransport(page, tls);
          const prefix = `${name}-${viewport.width}x${viewport.height}`;
          try {
            await page.goto(`${server.baseURL}__mobile-navigation?theme=${viewport.width === 430 ? 'dark' : 'light'}`);
            const editor = page.locator('.flower-composer textarea');
            await editor.waitFor();
            await page.locator('.flower-empty-suggestion').first().waitFor();
            await settle(page);
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
            await plugins.click();
            const pluginDrawer = page.locator('.plugin-mobile-launcher-drawer');
            await pluginDrawer.waitFor(); await settle(page);
            const plugin = await geometry(pluginDrawer); assertBounds(plugin, viewport);
            assert.ok(plugin.y >= 24 && parseFloat(plugin.radius) >= 20);
            assert.ok(!['INPUT', 'TEXTAREA'].includes(await page.evaluate(() => document.activeElement?.tagName)));
            await page.screenshot({ path: path.join(output, `${prefix}-plugins.png`) });
            await pluginDrawer.press('Escape'); await pluginDrawer.waitFor({ state: 'detached' });
            const terminalTab = page.getByRole('tab', { name: '终端', exact: true });
            await terminalTab.tap();
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
            assert.deepEqual(errors, []);
            results.push({ browser: name, viewport, flower, plugin, terminal: terminalBounds, errors });
          } catch (error) {
            failures.push({ browser: name, viewport, error: error.message, errors });
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
