import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopTestSession } from './desktop_test_session.mjs';

const root = process.cwd();
const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const fixture = argument('fixture'), output = argument('output');
const maximumInteractiveMs = argument('max-interactive-ms');
if (maximumInteractiveMs !== undefined) assert.ok(Number.isFinite(Number(maximumInteractiveMs)) && Number(maximumInteractiveMs) > 0, 'Provide a positive --max-interactive-ms.');
assert.ok(fixture && output, 'Provide --fixture and --output. The backend must use an isolated consistent copy.');
const info = JSON.parse(await readFile(fixture, 'utf8'));
const require = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
const desktop = createRequire(path.join(root, 'desktop/package.json'));
const { _electron: electron } = require('playwright');
const evidence = { fixture: info, requests: [], errors: [], opening: undefined, stability: [] };
await mkdir(path.dirname(output), { recursive: true });
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
try {
  await session.run(async () => {
    const application = await session.launchElectron(electron, {
      executablePath: desktop('electron'),
      args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), '--redeven-smoke-run=thread-open'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: output + '.profile', FLOWER_PERF_URL: info.url + '/?cpu=1&thread=' },
    });
    const page = await application.firstWindow();
    const pending = [];
    page.on('pageerror', error => evidence.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
    page.on('response', response => {
      const request = response.request(), url = new URL(response.url());
      if (url.pathname !== '/fixture') return;
      pending.push((async () => {
        const bytes = await response.body();
        evidence.requests.push({ op: url.searchParams.get('op'), status: response.status(), bytes: bytes.length,
          input: request.postData(), timing: request.timing() });
        if (!response.ok()) evidence.errors.push({ op: url.searchParams.get('op'), status: response.status() });
      })().catch(error => evidence.errors.push(String(error))));
    });
    const target = page.locator('[data-thread-id=' + JSON.stringify(info.thread) + '] .flower-thread-card-select-button');
    await target.scrollIntoViewIfNeeded();
    const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : undefined;
    if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    const tracer = process.argv.includes('--trace') ? await page.context().newCDPSession(page) : undefined;
    if (tracer) await tracer.send('Tracing.start', { categories: 'devtools.timeline,blink,cc,toplevel,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
    await page.evaluate(id => {
      window.threadOpenEvidence = { frames: [], clickedAt: undefined, interactiveAt: undefined, longTasks: [] };
      new PerformanceObserver(list => window.threadOpenEvidence.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
        .observe({ type: 'longtask', buffered: false });
      const click = event => {
        if (event.target.closest('[data-thread-id]')?.getAttribute('data-thread-id') !== id) return;
        document.removeEventListener('click', click, true);
        const evidence = window.threadOpenEvidence;
        evidence.clickedAt = performance.now(); evidence.trusted = event.isTrusted;
        let candidate;
        let stableFrames = 0;
        const check = () => {
          const main = document.querySelector('main[data-flower-selected-thread-id]');
          const selected = main?.getAttribute('data-flower-selected-thread-id') === id;
          const editor = main?.querySelector('.flower-composer textarea');
          const loading = main?.getAttribute('data-flower-selected-thread-loading');
          const messages = selected ? main.querySelectorAll('[data-flower-message-id]').length : 0;
          const failed = Boolean(main?.querySelector('.flower-thread-load-error,.flower-thread-sync-error'));
          const viewport = main?.querySelector('.flower-chat-transcript');
          const bounds = viewport?.getBoundingClientRect();
          const visible = node => {
            const box = node.getBoundingClientRect();
            return bounds && box.width > 0 && box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom
              && node.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
          };
          const pending = main ? [...main.querySelectorAll('.flower-history-body-control,.flower-history-text-loading,[data-flower-history-gap],[data-parent-event-gap]')].filter(visible).length : 0;
          const content = main ? [...main.querySelectorAll('[data-flower-message-id],[data-parent-event]')].filter(visible) : [];
          const last = content.at(-1);
          const y = last?.getBoundingClientRect().top;
          const preparing = viewport?.getAttribute('data-flower-tail-preparing') === 'true' || Boolean(viewport?.querySelector('.flower-transcript-stack[inert]'));
          const ready = Boolean(selected && loading === 'false' && content.length && editor && !editor.disabled && !editor.readOnly && !failed && !pending && !preparing);
          if (ready && candidate?.node === last && Math.abs(candidate.y - y) <= 1) stableFrames++;
          else { candidate = ready ? { node: last, y } : undefined; stableFrames = ready ? 1 : 0; }
          evidence.frames.push({ at: performance.now(), selected, loading, messages, visible: content.length, pending, failed, preparing, stableFrames,
            lastID: last?.getAttribute('data-flower-message-id') ?? last?.getAttribute('data-parent-event'), y, visibility: document.visibilityState,
            scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight });
          if (ready && stableFrames >= 3) {
            evidence.readyAt = performance.now();
            editor.focus(); evidence.focused = document.activeElement === editor; evidence.interactiveAt = performance.now();
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      };
      document.addEventListener('click', click, true);
    }, info.thread);
    await target.click();
    await page.waitForFunction(() => window.threadOpenEvidence.interactiveAt !== undefined, undefined, { timeout: 60000 });
    evidence.opening = await page.evaluate(() => {
      const value = window.threadOpenEvidence;
      return { ...value, interactiveMs: value.interactiveAt - value.clickedAt, readyMs: value.readyAt - value.clickedAt };
    });
    if (profiler) await writeFile(output + '.cpuprofile', JSON.stringify((await profiler.send('Profiler.stop')).profile));
    if (tracer) {
      const completed = new Promise(resolve => tracer.once('Tracing.tracingComplete', resolve));
      await tracer.send('Tracing.end');
      const { stream } = await completed;
      const chunks = [];
      for (;;) {
        const chunk = await tracer.send('IO.read', { handle: stream });
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data);
        if (chunk.eof) break;
      }
      await tracer.send('IO.close', { handle: stream });
      await writeFile(output + '.trace.json', chunks.join(''));
    }
    // Observe immediately after the readiness mark. A delayed replacement or
    // hydration flash must not disappear into an unmeasured settling pause.
    evidence.stability = await page.evaluate(async () => {
      const viewport = document.querySelector('.flower-chat-transcript');
      const retained = [...document.querySelectorAll('[data-flower-message-id]')].at(-1);
      if (!viewport || !retained) throw new Error('Missing transcript.');
      const id = retained.getAttribute('data-flower-message-id'), y = retained.getBoundingClientRect().top;
      const frames = [];
      for (let index = 0; index < 90; index++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frames.push({ sameNode: document.querySelector('[data-flower-message-id=' + JSON.stringify(id) + ']') === retained,
          displacement: Math.abs(retained.getBoundingClientRect().top - y),
          failed: Boolean(document.querySelector('.flower-thread-load-error,.flower-thread-sync-error')),
          loading: document.querySelector('main[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-loading') !== 'false' });
      }
      return frames;
    });
    const editor = page.locator('.flower-composer textarea');
    await editor.pressSequentially('Qualification draft');
    assert.equal(await editor.inputValue(), 'Qualification draft');
    await editor.fill('');
    if (process.argv.includes('--interactions')) {
      const viewport = page.locator('.flower-chat-transcript');
      const failures = '.flower-thread-load-error,.flower-thread-sync-error,.flower-history-read-error';
      const checkReady = async () => {
        await page.waitForFunction(() => {
          const viewport = document.querySelector('.flower-chat-transcript');
          const bounds = viewport?.getBoundingClientRect();
          return bounds && ![...viewport.querySelectorAll('.flower-history-body-control,.flower-history-text-loading,[data-flower-history-gap],[data-parent-event-gap]')].some(node => {
            const box = node.getBoundingClientRect();
            return box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom;
          });
        }, undefined, { timeout: 60000 });
        assert.equal(await page.locator(failures).count(), 0);
        assert.equal(await viewport.getByRole('button', { name: /^(Load (earlier|newer)|Earlier messages|Newer messages)$/i }).count(), 0);
      };
      evidence.interactions = [];
      await page.screenshot({ path: output + '.opened.png' });
      for (let step = 0; step < 4; step++) {
        await viewport.hover();
        await page.mouse.wheel(0, -550);
        await page.waitForTimeout(350);
        await checkReady();
        evidence.interactions.push({ action: 'scroll-earlier', step });
      }
      const disclosure = await page.evaluate(() => {
        const bounds = document.querySelector('.flower-chat-transcript')?.getBoundingClientRect();
        return [...document.querySelectorAll('.flower-activity-inline-row')].find(row => {
          const box = row.getBoundingClientRect();
          return bounds && box.height > 0 && box.top >= bounds.top && box.bottom <= bounds.bottom
            && row.querySelector('button[data-flower-disclosure-trigger]');
        })?.getAttribute('data-flower-activity-item-id');
      });
      if (disclosure) {
        const row = page.locator('[data-flower-activity-item-id=' + JSON.stringify(disclosure) + ']');
        const button = row.locator('button[data-flower-disclosure-trigger]').first();
        const original = await button.getAttribute('aria-expanded');
        await button.click();
        await page.waitForFunction(({ id, original }) => document.querySelector('[data-flower-activity-item-id=' + JSON.stringify(id) + '] button[data-flower-disclosure-trigger]')?.getAttribute('aria-expanded') !== original, { id: disclosure, original });
        await checkReady();
        await page.screenshot({ path: output + '.detail.png' });
        await button.click();
        assert.equal(await button.getAttribute('aria-expanded'), original);
        evidence.interactions.push({ action: 'toggle-detail-twice', item: disclosure });
      }
      for (let step = 0; step < 4; step++) {
        await viewport.hover();
        await page.mouse.wheel(0, 550);
        await page.waitForTimeout(350);
        await checkReady();
      }
      await page.screenshot({ path: output + '.returned.png' });
    }
    await Promise.all(pending);
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    assert.equal(evidence.errors.length, 0, JSON.stringify(evidence.errors));
    assert.ok(evidence.opening.trusted && evidence.opening.focused);
    assert.ok(evidence.stability.every(frame => frame.sameNode && frame.displacement <= 1 && !frame.failed && !frame.loading));
    console.log(JSON.stringify({ interactiveMs: evidence.opening.interactiveMs, readyMs: evidence.opening.readyMs,
      requests: evidence.requests.map(({ op, bytes, status, timing }) => ({ op, bytes, status, timing })), errors: evidence.errors }));
    if (maximumInteractiveMs !== undefined) {
      assert.ok(evidence.opening.interactiveMs < Number(maximumInteractiveMs), 'Click-to-interactive exceeds the requested limit.');
    }
  });
} finally {
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
