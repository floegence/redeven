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
  const { PNG } = requireUI('pngjs');
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
  const rapidOnly = process.argv.includes('--pin-rapid-only');
  const pinsOnly = rapidOnly || process.argv.includes('--pins-only');
  for (let index = 0; index < (pinsOnly ? 0 : 18); index++) {
    const id = index % 2 ? (index >= 14 ? 'sidebar-huge' : 'sidebar-large') : 'sidebar-small';
    await page.locator('[data-thread-id="' + id + '"]').hover();
    const result = await page.evaluate(id => window.flowerSidebar.select(id), id);
    assert.equal(result.synchronous.active, result.id);
    assert.equal(result.synchronous.committed, result.committedBefore);
    assert.equal(result.synchronous.rows, result.beforeRows);
    assert.equal(result.synchronous.parses, 0);
    const committing = result.events.find(event => event.phase === 'commit_started');
    assert.ok(committing?.hovered, 'Selection qualification must include actual pointer hover');
    assert.equal(committing.background, result.background, 'Selection highlight must reach its final color before content work starts');
    selections.push(result);
  }
  const cdp = await app.context().newCDPSession(page);
  const trace = [];
  cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.screenshot', transferMode: 'ReportEvents' });
  const painted = [];
  const pixel = (png, sample) => {
    const scale = png.width / sample.viewportWidth;
    const offset = (Math.floor(sample.y * scale) * png.width + Math.floor(sample.x * scale)) * 4;
    return [...png.data.subarray(offset, offset + 3)];
  };
  for (const id of pinsOnly ? [] : ['sidebar-small', 'sidebar-large', 'sidebar-small', 'sidebar-huge']) {
    await page.locator('[data-thread-id="' + id + '"]').hover();
    const result = await page.evaluate(id => window.flowerSidebar.select(id), id);
    const reference = PNG.sync.read(await page.screenshot());
    await writeFile(path.join(output, 'selection-reference-' + painted.length + '.png'), PNG.sync.write(reference));
    painted.push({ id, sample: result.sample, rgb: pixel(reference, result.sample) });
  }
  const traceComplete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await traceComplete;
  await writeFile(path.join(output, 'selection-trace.json'), JSON.stringify({ traceEvents: trace }));
  await writeFile(path.join(output, 'paint-samples.json'), JSON.stringify(painted, null, 2));
  const requests = trace.filter(event => event.name === 'sidebar-selection-requested');
  const commits = trace.filter(event => event.name === 'sidebar-selection-commit_started');
  assert.equal(requests.length, painted.length);
  for (let index = 0; index < painted.length; index++) {
    const frames = trace.filter(event => event.name === 'Screenshot'
      && event.ts > requests[index].ts && event.args.expected_display_time < commits[index].ts);
    let evidence;
    for (const frame of frames) {
      const png = await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).toPNG().toString('base64'), frame.args.snapshot);
      const rgb = pixel(PNG.sync.read(Buffer.from(png, 'base64')), painted[index].sample);
      if (rgb.every((channel, i) => Math.abs(channel - painted[index].rgb[i]) <= 8)) {
        evidence = frame;
        await writeFile(path.join(output, 'selection-before-content-' + index + '.png'), Buffer.from(png, 'base64'));
        painted[index].paintMs = (frame.ts - requests[index].ts) / 1000;
        painted[index].displayMs = (frame.args.expected_display_time - requests[index].ts) / 1000;
        painted[index].commitMs = (commits[index].ts - requests[index].ts) / 1000;
        break;
      }
    }
    assert.ok(evidence, 'Trace must show the selected background before content commit: ' + painted[index].id);
  }
  await page.screenshot({ path: path.join(output, 'large-conversation.png') });
  const pins = [];
  for (const width of rapidOnly || process.argv.includes('--selection-only') ? [] : [220, 224, 272, 360]) {
    console.log('Sidebar pin qualification width: ' + width);
    await page.evaluate(width => document.querySelector('.flower-surface').style.setProperty('--flower-thread-rail-width', width + 'px'), width);
    for (let index = 0; index < 16; index++) {
      const id = ['sidebar-2', 'sidebar-3', 'sidebar-4', 'sidebar-5'][index % 4];
      const control = page.locator('[data-thread-id="' + id + '"] .flower-thread-card-pin-button');
      await page.locator('.flower-component-thread-rail .flower-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.mouse.move(0, 0);
      await page.locator('[data-thread-id="' + id + '"]').hover();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const bounds = await control.evaluate(button => button.getBoundingClientRect().toJSON());
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0, 'Pin action must occupy a visible hit target');
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await page.mouse.move(point.x, point.y);
      await page.evaluate(({ id, index }) => {
        const row = document.querySelector('[data-thread-id="' + id + '"]');
        const title = row.querySelector('.flower-thread-list-title');
        const wave = row.querySelector('.flower-thread-wave-bar');
        const animation = wave?.getAnimations()[0];
        const time = animation?.currentTime;
        const button = row.querySelector('.flower-thread-card-pin-button');
        const beforePinned = button.getAttribute('aria-label');
        const wasPinned = row.dataset.pinned === 'true';
        const pinnedOrder = () => [...document.querySelectorAll('[data-thread-id][data-pinned="true"]')].map(item => item.dataset.threadId);
        const appendOrder = JSON.stringify([...pinnedOrder(), id]);
        const initial = window.flowerSidebar.pinState();
        if (index === 7) window.flowerSidebar.failNextPin();
        const actionBounds = button.getBoundingClientRect();
        if (actionBounds.width <= 0 || actionBounds.height <= 0
          || getComputedStyle(button).display === 'none'
          || getComputedStyle(button.parentElement).opacity !== '1'
          || !button.contains(document.elementFromPoint(actionBounds.x + actionBounds.width / 2, actionBounds.y + actionBounds.height / 2))) {
          throw new Error('Pin action must be visible and hit-testable before clicking: ' + JSON.stringify({ id, actionBounds }));
        }
        window.flowerPinSample = new Promise(resolve => button.addEventListener('click', () => resolve((async () => {
          let frames = 0;
          const invalid = [];
          let disabledFrames = 0;
          let appendOrderStable = true;
          const start = performance.now();
          do {
            await new Promise(requestAnimationFrame); frames++;
            if (button.disabled) disabledFrames++;
            if (!wasPinned && index !== 7 && JSON.stringify(pinnedOrder()) !== appendOrder) appendOrderStable = false;
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
          } while ((window.flowerSidebar.pinState().pinSettled === initial.pinSettled
            || window.flowerSidebar.pinState().listSettled === initial.listSettled || frames < 3) && performance.now() - start < 3000);
          return { id, frames, invalid, disabledFrames, appendOrderStable, actionWidth: actionBounds.width, rowRetained: row === document.querySelector('[data-thread-id="' + id + '"]'),
            titleRetained: title === row.querySelector('.flower-thread-list-title'), focusRetained: document.activeElement === button,
            animationRetained: !animation || animation === wave.getAnimations()[0] && animation.currentTime >= time,
            settled: window.flowerSidebar.pinState().pinSettled > initial.pinSettled, rolledBack: index !== 7 || button.getAttribute('aria-label') === beforePinned };
        })()), { once: true }));
      }, { id, index });
      await page.mouse.click(point.x, point.y);
      if (index === 3) await page.evaluate(id => window.flowerSidebar.updateTitle(id), id);
      const result = await page.evaluate(() => window.flowerPinSample);
      assert.deepEqual(result.invalid, []);
      assert.equal(result.disabledFrames, 0, 'Pin actions remain available during confirmation');
      assert.ok(result.appendOrderStable, 'New pins must remain at the tail through confirmation');
      assert.ok(result.rowRetained && result.titleRetained && result.focusRetained && result.animationRetained && result.settled && result.rolledBack, JSON.stringify(result));
      pins.push({ width, ...result });
      console.log('Sidebar pin operation passed: ' + width + '/' + index);
    }
    const reorder = await page.evaluate(async () => {
      const row = document.querySelector('[data-thread-id="sidebar-4"]');
      const title = row.querySelector('.flower-thread-list-title');
      const button = row.querySelector('.flower-thread-card-menu-button');
      button.focus(); button.click();
      await new Promise(requestAnimationFrame);
      const down = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('Move down'));
      if (!down || down.disabled) throw new Error('Pinned reorder action is unavailable');
      const initial = window.flowerSidebar.pinState().pinSettled;
      down.click();
      let frames = 0;
      do {
        await new Promise(requestAnimationFrame); frames++;
        const bounds = title.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Pinned reorder lost title layout');
      } while (window.flowerSidebar.pinState().pinSettled === initial && frames < 120);
      return { frames, rowRetained: row === document.querySelector('[data-thread-id="sidebar-4"]'),
        titleRetained: title === row.querySelector('.flower-thread-list-title'),
        order: [...document.querySelectorAll('[data-thread-id][data-pinned="true"]')].map(item => item.dataset.threadId) };
    });
    assert.ok(reorder.rowRetained && reorder.titleRetained);
    assert.ok(reorder.order.indexOf('sidebar-3') < reorder.order.indexOf('sidebar-4'));
    await page.locator('[data-thread-id="sidebar-4"]').hover();
    await page.locator('.flower-component-thread-rail').screenshot({ path: path.join(output, 'rail-' + width + '.png') });
  }
  const rapid = process.argv.includes('--selection-only') ? null : await page.evaluate(async () => {
    window.flowerSidebar.setDelays(250, 900);
    const row = document.querySelector('[data-thread-id="sidebar-6"]');
    const title = row.querySelector('.flower-thread-list-title');
    const button = row.querySelector('.flower-thread-card-pin-button');
    const other = document.querySelector('[data-thread-id="sidebar-7"] .flower-thread-card-pin-button');
    const initial = window.flowerSidebar.pinState();
    const focusEvents = [];
    const recordFocus = event => focusEvents.push({ type: event.type, time: performance.now(),
      target: event.target.className, thread: event.target.closest?.('[data-thread-id]')?.dataset.threadId });
    document.addEventListener('focusin', recordFocus, true);
    document.addEventListener('focusout', recordFocus, true);
    button.focus();
    const started = performance.now();
    button.click(); button.click(); button.click(); other.click();
    const syncMs = performance.now() - started;
    const immediate = { pinned: row.dataset.pinned, otherPinned: other.closest('[data-thread-id]').dataset.pinned,
      disabled: button.disabled || other.disabled, requests: window.flowerSidebar.pinState().pinStarted - initial.pinStarted };
    while (window.flowerSidebar.pinState().pinSettled < initial.pinSettled + 3) {
      await new Promise(requestAnimationFrame);
      if (performance.now() - started > 7000) throw new Error('Rapid pin write queue timed out');
    }
    const duringRead = window.flowerSidebar.pinState();
    button.click();
    const writeDuringRead = window.flowerSidebar.pinState().pinStarted > duringRead.pinStarted
      && duringRead.listStarted > duringRead.listSettled;
    let frames = 0;
    let disabledFrames = 0;
    let invalidFrames = 0;
    do {
      await new Promise(requestAnimationFrame); frames++;
      if (button.disabled || other.disabled) disabledFrames++;
      const bounds = title.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) invalidFrames++;
      if (performance.now() - started > 7000) throw new Error('Rapid pin confirmation timed out');
    } while (window.flowerSidebar.pinState().pinStarted !== window.flowerSidebar.pinState().pinSettled
      || window.flowerSidebar.pinState().listStarted !== window.flowerSidebar.pinState().listSettled);
    document.removeEventListener('focusin', recordFocus, true);
    document.removeEventListener('focusout', recordFocus, true);
    return { syncMs, immediate, writeDuringRead, frames, disabledFrames, invalidFrames, focusEvents,
      focusedClass: document.activeElement.className, focusedThread: document.activeElement.closest('[data-thread-id]')?.dataset.threadId,
      rowRetained: row === document.querySelector('[data-thread-id="sidebar-6"]'),
      titleRetained: title === row.querySelector('.flower-thread-list-title'), focusRetained: document.activeElement === button,
      finalPinned: row.dataset.pinned, otherPinned: other.closest('[data-thread-id]').dataset.pinned,
      requests: window.flowerSidebar.pinState().pinCalls.slice(initial.pinCalls.length) };
  });
  if (rapid) {
    await writeFile(path.join(output, 'rapid-results.json'), JSON.stringify(rapid, null, 2));
    console.log('Rapid pin diagnostics: ' + path.join(output, 'rapid-results.json'));
    assert.deepEqual(rapid.immediate, { pinned: 'true', otherPinned: 'true', disabled: false, requests: 1 });
    assert.ok(rapid.writeDuringRead, 'A delayed list read must not block another write');
    assert.ok(rapid.rowRetained && rapid.titleRetained && rapid.focusRetained, JSON.stringify(rapid));
    assert.equal(rapid.finalPinned, 'false');
    assert.equal(rapid.otherPinned, 'true');
    assert.equal(rapid.disabledFrames, 0);
    assert.equal(rapid.invalidFrames, 0);
    assert.deepEqual(rapid.requests, [{ id: 'sidebar-6', pinned: true }, { id: 'sidebar-6', pinned: true },
      { id: 'sidebar-7', pinned: true }, { id: 'sidebar-6', pinned: false }]);
    await page.locator('.flower-component-thread-rail').screenshot({ path: path.join(output, 'rapid-pins.png') });
  }
  assert.deepEqual(pageErrors, []);
  const sorted = selections.slice(2).map(value => value.syncMs).sort((a, b) => a - b);
  const clickP95 = pinsOnly ? null : sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (!pinsOnly) assert.ok(clickP95 < 8, 'Warm sidebar click P95 must stay below 8ms: ' + clickP95);
  const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
    version, clickP95, selections, painted, pins, rapid, frames: pins.reduce((sum, value) => sum + value.frames, 0),
    traceScreenshots: trace.filter(value => value.name === 'Screenshot').length };
  await session.writeEvidence(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, electron: version.electron, chrome: version.chrome, clickP95, pinOperations: pins.length, sampledFrames: report.frames, traceScreenshots: report.traceScreenshots, rapid }));
  await session.closeElectron(app);
});
