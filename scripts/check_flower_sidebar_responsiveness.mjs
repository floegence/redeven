import { createDesktopTestSession } from './desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 240000 });
await session.run(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
  const requireUI = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
  const { _electron } = requireUI('playwright');
  const { build } = await import(pathToFileURL(requireDesktop.resolve('vite')));
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-sidebar-build-'));
  await session.directory(temporary);
  const output = process.argv.find(value => value.startsWith('--output='))?.slice(9)
    || await mkdtemp(path.join(tmpdir(), 'flower-sidebar-evidence-'));
  await mkdir(output, { recursive: true });
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const dist = path.join(temporary, 'dist');
  await build({ configFile: path.join(root, 'desktop/vite.welcome.config.mjs'), logLevel: 'error',
    plugins: [{ name: 'sidebar-markdown-counts', enforce: 'pre', transform(code, id) {
      if (!id.endsWith('/chat/markdown/FlowerMarkdownBlock.tsx')) return;
      const marker = 'const renderMarkdown = createMarkdownRenderModel(marked);';
      assert.ok(code.includes(marker), 'Markdown measurement boundary must exist');
      return code.replace(marker, "for (const [method, count] of [['parser', 'parses'], ['lexer', 'lexes']]) { const original = marked[method].bind(marked); marked[method] = (...args) => { window.__flowerPerfCounts[count]++; return original(...args); }; }\n" + marker);
    } }],
    build: { outDir: dist, emptyOutDir: true, cssCodeSplit: false, rollupOptions: {
      input: path.join(root, 'internal/flower_ui/testing/performance/sidebar.tsx'), output: { entryFileNames: 'sidebar.js' },
    } },
  });
  const css = (await readdir(path.join(dist, 'assets'))).filter(value => value.endsWith('.css'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8">'
    + css.map(value => '<link rel="stylesheet" href="/assets/' + value + '">').join('')
    + '</head><body><div id="root"></div><script type="module" src="/sidebar.js"></script></body></html>');
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const content = await readFile(target);
      response.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      response.end(content);
    } catch { response.writeHead(404).end(); }
  });
  await session.defer('sidebar fixture server', () => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await session.port(server.address().port);
  const app = await session.launchElectron(_electron, { executablePath: requireDesktop('electron'),
    args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: path.join(temporary, 'profile'),
      FLOWER_PERF_URL: 'http://127.0.0.1:' + server.address().port },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => !!window.flowerSidebar);
  const version = await app.evaluate(() => process.versions);
  assert.equal(version.electron, JSON.parse(await readFile(path.join(root, 'desktop/package.json'))).devDependencies.electron);
  const selections = [];
  for (let index = 0; index < 14; index++) {
    const result = await page.evaluate(index => window.flowerSidebar.select(index % 2 ? window.flowerSidebar.bigID : window.flowerSidebar.smallID), index);
    assert.equal(result.synchronous.active, result.id);
    assert.equal(result.synchronous.committed, result.committedBefore);
    assert.equal(result.synchronous.rows, result.beforeRows);
    assert.equal(result.synchronous.parses, 0);
    selections.push(result);
  }
  const cdp = await app.context().newCDPSession(page);
  const trace = [];
  cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.screenshot', transferMode: 'ReportEvents' });
  await page.evaluate(() => window.flowerSidebar.select(window.flowerSidebar.smallID));
  await page.evaluate(() => window.flowerSidebar.select(window.flowerSidebar.bigID));
  const traceComplete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await traceComplete;
  await writeFile(path.join(output, 'selection-trace.json'), JSON.stringify({ traceEvents: trace }));
  await page.screenshot({ path: path.join(output, 'large-conversation.png') });
  const pins = [];
  for (const width of [224, 272, 360]) {
    await page.evaluate(width => document.querySelector('.flower-surface').style.setProperty('--flower-thread-rail-width', width + 'px'), width);
    for (let index = 0; index < 16; index++) {
      const id = ['sidebar-2', 'sidebar-3', 'sidebar-4', 'sidebar-5'][index % 4];
      const result = await page.evaluate(async ({ id, index }) => {
        const row = document.querySelector('[data-thread-id="' + id + '"]');
        const title = row.querySelector('.flower-thread-list-title');
        const wave = row.querySelector('.flower-thread-wave-bar');
        const animation = wave?.getAnimations()[0];
        const time = animation?.currentTime;
        const button = row.querySelector('.flower-thread-card-pin-button');
        const beforePinned = button.getAttribute('aria-label');
        if (index === 7) window.flowerSidebar.failNextPin();
        const focused = row.querySelector('.flower-thread-card-select-button');
        focused.focus(); button.click();
        if (index === 3) window.flowerSidebar.updateTitle(id);
        let frames = 0;
        const invalid = [];
        const start = performance.now();
        do {
          await new Promise(requestAnimationFrame); frames++;
          for (const card of document.querySelectorAll('[data-flower-thread-card]')) {
            const bounds = card.getBoundingClientRect();
            if (bounds.bottom <= 0 || bounds.top >= innerHeight) continue;
            const label = card.querySelector('.flower-thread-list-title');
            const select = card.querySelector('.flower-thread-card-select-button');
            for (const element of [label, select]) {
              const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
              if (!element.textContent.trim() || rect.width <= 0 || rect.height <= 0 || style.visibility !== 'visible' || style.opacity === '0') invalid.push(card.dataset.threadId);
            }
          }
        } while ((button.disabled || frames < 3) && performance.now() - start < 3000);
        return { id, frames, invalid, rowRetained: row === document.querySelector('[data-thread-id="' + id + '"]'),
          titleRetained: title === row.querySelector('.flower-thread-list-title'), focusRetained: document.activeElement === focused,
          animationRetained: !animation || animation === wave.getAnimations()[0] && animation.currentTime >= time,
          settled: !button.disabled, rolledBack: index !== 7 || button.getAttribute('aria-label') === beforePinned };
      }, { id, index });
      assert.deepEqual(result.invalid, []);
      assert.ok(result.rowRetained && result.titleRetained && result.focusRetained && result.animationRetained && result.settled && result.rolledBack, JSON.stringify(result));
      pins.push({ width, ...result });
    }
    const reorder = await page.evaluate(async () => {
      const row = document.querySelector('[data-thread-id="sidebar-4"]');
      const title = row.querySelector('.flower-thread-list-title');
      const button = row.querySelector('.flower-thread-card-menu-button');
      button.focus(); button.click();
      await new Promise(requestAnimationFrame);
      const down = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('Move down'));
      if (!down || down.disabled) throw new Error('Pinned reorder action is unavailable');
      down.click();
      let frames = 0;
      do {
        await new Promise(requestAnimationFrame); frames++;
        const bounds = title.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Pinned reorder lost title layout');
      } while (row.querySelector('.flower-thread-card-pin-button').disabled && frames < 120);
      return { frames, rowRetained: row === document.querySelector('[data-thread-id="sidebar-4"]'),
        titleRetained: title === row.querySelector('.flower-thread-list-title'),
        order: [...document.querySelectorAll('[data-thread-id][data-pinned="true"]')].map(item => item.dataset.threadId) };
    });
    assert.ok(reorder.rowRetained && reorder.titleRetained);
    assert.ok(reorder.order.indexOf('sidebar-3') < reorder.order.indexOf('sidebar-4'));
    await page.locator('.flower-component-thread-rail').screenshot({ path: path.join(output, 'rail-' + width + '.png') });
  }
  assert.deepEqual(pageErrors, []);
  const sorted = selections.slice(2).map(value => value.syncMs).sort((a, b) => a - b);
  const clickP95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  assert.ok(clickP95 < 8, 'Warm sidebar click P95 must stay below 8ms: ' + clickP95);
  const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
    version, clickP95, selections, pins, frames: pins.reduce((sum, value) => sum + value.frames, 0),
    traceScreenshots: trace.filter(value => value.name === 'Screenshot').length };
  await session.writeEvidence(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, electron: version.electron, chrome: version.chrome, clickP95, pinOperations: pins.length, sampledFrames: report.frames, traceScreenshots: report.traceScreenshots }));
  await session.closeElectron(app);
});
