import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDesktopTestSession } from './desktop_test_session.mjs';

// Explicit qualification only. Build before measurement; never record video.
const root = process.cwd();
const argument = (name, fallback = '') => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const dist = path.resolve(argument('dist'));
const ui = path.join(root, 'internal/envapp/ui_src');
const require = createRequire(path.join(ui, 'package.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
if (process.argv.includes('--build')) {
  const { build, loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')));
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(ui, 'vite.config.ts'));
  const entry = 'virtual:cpu-qualification';
  const source = [path.join(ui, 'src/index.css'), path.join(root, 'internal/flower_ui/testing/compaction/main.tsx')]
    .map(file => 'import ' + JSON.stringify(file) + ';').join('\n');
  await build({
    ...loaded.config, root: ui, base: '/', configFile: false, logLevel: 'error',
    plugins: [...loaded.config.plugins, { name: 'flower-cpu-qualification', resolveId: id => id === entry ? entry : undefined, load: id => id === entry ? source : undefined }],
    build: { ...loaded.config.build, outDir: dist, emptyOutDir: true, manifest: false, sourcemap: true, cssCodeSplit: false, rolldownOptions: undefined, rollupOptions: { input: entry, output: { entryFileNames: 'qualification.js' } } },
  });
  const assets = await readdir(path.join(dist, 'assets'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html class="light"><head><meta charset="utf-8">'
    + assets.filter(file => file.endsWith('.css')).map(file => '<link rel="stylesheet" href="/assets/' + file + '">').join('')
    + '</head><body><div id="root"></div><script type="module" src="/qualification.js"></script></body></html>');
  console.log(JSON.stringify({ built: dist }));
} else {
  const url = argument('url') || JSON.parse(await readFile(argument('fixture'), 'utf8')).url;
  const seconds = Number(argument('seconds', '120'));
  const warmup = Number(argument('warmup', '10'));
  const threads = Number(argument('threads', '1'));
  const hz = Number(argument('hz', '40'));
  assert.ok(seconds > 0 && warmup >= 0 && threads >= 1 && threads <= 7);
  const output = path.resolve(argument('output'));
  await mkdir(path.dirname(output), { recursive: true });
  const api = async (op, extra = '') => {
    const response = await fetch(url + '/fixture?op=' + op + extra);
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const setup = await api('setup');
  assert.equal(setup.history_verified, true, 'canonical seed history must be verified before measurement');
  assert.equal(setup.history_messages, 2 * setup.history_turns);
  assert.equal(setup.history_completed_activities, 2 * setup.history_turns);
  const workload = argument('mode', 'mixed');
  const initialBytes = Number(argument('initial-bytes', '0'));
  const idle = process.argv.includes('--idle');
  const configured = await api('configure', '&threads=' + threads + '&hz=' + hz + '&mode=' + workload + '&initial_bytes=' + initialBytes);
  const { _electron: electron } = require('playwright');
  const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
  const session = await createDesktopTestSession(import.meta.url, { timeoutMs: (seconds + warmup + 120) * 1000 });
  await session.run(async () => {
    const profile = output + '.profile';
    const application = await session.launchElectron(electron, {
      executablePath: desktopRequire('electron'),
      args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), '--redeven-smoke-run=flower-cpu'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: profile, FLOWER_PERF_URL: url + '/?cpu=1&thread=' + configured.threads[0] },
    });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    const consoleErrors = [];
    const diagnosticReads = [];
    page.on('console', message => {
      if (message.type() !== 'error') return;
      console.error('renderer:', message.text());
      diagnosticReads.push(Promise.all(message.args().map(argument => argument.jsonValue().catch(() => undefined)))
        .then(arguments_ => consoleErrors.push({ message: message.text(), arguments: arguments_ })));
    });
    await page.locator('.flower-composer textarea').waitFor({ timeout: 30000 });
    await page.locator('[data-flower-message-id]').first().waitFor({ timeout: 30000 });
    await page.evaluate(({ idle }) => {
      window.flowerCPU = { frames: [], longTasks: [], inputs: [], clicks: [], outputs: [], active: false };
      const observed = new Set();
      const lengths = new WeakMap();
      const scan = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (scan.nextNode()) lengths.set(scan.currentNode, scan.currentNode.length);
      new MutationObserver(records => {
        if (!window.flowerCPU.active) return;
        for (const record of records) {
          if (!(record.target.parentElement?.closest('.flower-chat-md-block'))) continue;
          const nodes = record.type === 'characterData' ? [record.target] : [...record.addedNodes];
          for (const node of nodes) {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const texts = node instanceof Text ? [node] : [];
            while (walker.nextNode()) texts.push(walker.currentNode);
            for (const value of texts) {
              const start = Math.max(0, (lengths.get(value) ?? 0) - 12);
              const text = value.substringData(start, value.length - start);
              lengths.set(value, value.length);
              for (const match of text.matchAll(/word(\d{6})/g)) {
                const index = Number(match[1]);
                if (!observed.has(index)) { observed.add(index); window.flowerCPU.outputs.push({ index, at: Date.now() }); }
              }
            }
          }
        }
      }).observe(document.body, { characterData: true, childList: true, subtree: true });
      const state = window.flowerCPU;
      let previous = performance.now();
      const frame = now => { if (state.active) state.frames.push(now - previous); previous = now; requestAnimationFrame(frame); };
      if (!idle) requestAnimationFrame(frame);
      new PerformanceObserver(list => { if (state.active) state.longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
      document.addEventListener('input', event => { const at = event.timeStamp; requestAnimationFrame(() => { if (state.active) state.inputs.push(performance.now() - at); }); });
      document.addEventListener('click', event => { const at = event.timeStamp; requestAnimationFrame(() => { if (state.active) state.clicks.push(performance.now() - at); }); });
    }, { idle });
    const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : undefined;
    if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    const tracer = process.argv.includes('--trace') ? await page.context().newCDPSession(page) : undefined;
    const trace = [];
    if (tracer) {
      tracer.on('Tracing.dataCollected', event => trace.push(...event.value));
      await tracer.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking', options: 'record-as-much-as-possible' });
    }
    const metrics = () => application.evaluate(({ app }) => app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type, cpu: item.cpu.cumulativeCPUUsage })));
    const runtimeCPU = () => {
      const value = execFileSync('ps', ['-p', String(setup.pid), '-o', 'time='], { encoding: 'utf8' }).trim();
      return value.split(':').reduce((total, piece) => total * 60 + Number(piece), 0);
    };
    let evidence;
    try {
      if (process.argv.includes('--stability')) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        const samples = [];
        const deadline = performance.now() + seconds * 1000;
        let cycle = 0;
        while (performance.now() < deadline) {
          const cycleStart = performance.now();
          const startCPU = { runtime: runtimeCPU(), app: await metrics(), time: performance.now() };
          await api('start', '&threads=' + threads);
          await page.waitForTimeout(10000);
          const elapsed = (performance.now() - startCPU.time) / 1000;
          const app = await metrics();
          const cpu = { runtime: 100 * (runtimeCPU() - startCPU.runtime) / elapsed, app: 100 * app.reduce((sum, value) => sum + value.cpu - (startCPU.app.find(prior => prior.pid === value.pid)?.cpu ?? 0), 0) / elapsed };
          await page.locator('.flower-composer textarea').fill('Retained stability draft');
          await api('stop');
          const completed = await Promise.all(configured.threads.map(id => api('evidence', '&id=' + encodeURIComponent(id))));
          assert.ok(completed.every(run => run.exact_text && run.exact_reasoning), 'every stability cycle must preserve provider content');
          await page.evaluate(() => window.flowerQualification.setVisible(false));
          await page.locator('.flower-composer textarea').waitFor({ state: 'detached' });
          await page.waitForTimeout(100);
          assert.equal((await api('stats')).subscribers, 0, 'closing the panel releases its stream');
          await page.evaluate(() => window.flowerQualification.setVisible(true));
          await page.locator('.flower-composer textarea').waitFor();
          assert.equal(await page.locator('.flower-composer textarea').inputValue(), 'Retained stability draft', 'closing and reopening the panel preserves its draft');
          await page.goto('about:blank');
          await cdp.send('HeapProfiler.collectGarbage');
          await page.waitForTimeout(1000);
          const released = await api('stats');
          assert.equal(released.subscribers, 0, 'closing the document must release its runtime subscription');
          assert.equal(released.queued_bytes, 0, 'closing the document must release queued buffers');
          const next = await api('configure', '&threads=' + threads + '&hz=' + hz + '&mode=' + workload + '&initial_bytes=' + initialBytes);
          configured.threads = next.threads;
          await page.goto(url + '/?cpu=1&thread=' + next.threads[0]);
          await page.locator('.flower-composer textarea').waitFor();
          await page.locator('[data-flower-message-id]').first().waitFor();
          await page.waitForTimeout(1000);
          await cdp.send('HeapProfiler.collectGarbage');
          const renderer = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
          samples.push({ cycle: ++cycle, at: Date.now(), cpu, runtime: await api('stats', '&gc=1'), released, renderer, processes: await metrics() });
          evidence = { seconds, cycle, samples, errors };
          await writeFile(output, JSON.stringify(evidence, null, 2) + String.fromCharCode(10));
          await page.waitForTimeout(Math.min(Math.max(0, 60000 - (performance.now() - cycleStart)), Math.max(0, deadline - performance.now())));
        }
        const early = samples.slice(2, 7), late = samples.slice(-5);
        const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const growth = key => median(late.map(value => key(value))) / median(early.map(value => key(value)));
        evidence = { seconds, cycle, samples, errors, heapGrowth: growth(value => value.renderer.JSHeapUsedSize), runtimeHeapGrowth: growth(value => value.runtime.heap_bytes), runtimeCPUGrowth: growth(value => value.cpu.runtime), appCPUGrowth: growth(value => value.cpu.app), nodeGrowth: growth(value => value.renderer.Nodes), listenerGrowth: growth(value => value.renderer.JSEventListeners) };
        await writeFile(output, JSON.stringify(evidence, null, 2) + String.fromCharCode(10));
        assert.ok(samples.length >= 30 && seconds >= 1800, 'stability qualification requires at least thirty minutes and cycles');
        assert.ok(evidence.heapGrowth <= 1.1 && evidence.nodeGrowth <= 1.1 && evidence.listenerGrowth <= 1.1, 'fixed working set must not accumulate renderer resources');
        assert.ok(evidence.runtimeHeapGrowth <= 1.1, 'fixed working set must not accumulate runtime heap');
        assert.ok(evidence.runtimeCPUGrowth <= 1.25 && evidence.appCPUGrowth <= 1.25, 'fixed working set must not accumulate CPU work');
        assert.ok(Math.max(...late.map(value => value.runtime.goroutines)) <= Math.max(...early.map(value => value.runtime.goroutines)) + 2, 'runtime goroutines must return to their bounded baseline');
        assert.ok(samples.every(value => value.runtime.subscribers === 1 && value.released.subscribers === 0), 'one document must own exactly one releasable subscription');
        assert.deepEqual(errors, []);
        return;
      }
      if (!idle) await api('start', '&threads=' + threads);
      await page.waitForTimeout(warmup * 1000);
      const before = { runtime: runtimeCPU(), app: await metrics(), stats: await api('stats'), time: performance.now(), wallTime: Date.now() };
      await page.evaluate(() => { window.flowerCPU.active = true; });
      const deadline = performance.now() + seconds * 1000;
      while (performance.now() < deadline) {
        if (!idle) {
          await page.locator('.flower-composer textarea').click();
          await page.locator('.flower-composer textarea').fill('CPU qualification draft ' + Math.floor(performance.now()));
        }
        await page.waitForTimeout(Math.min(5000, Math.max(0, deadline - performance.now())));
      }
      if (profiler) { const { profile } = await profiler.send('Profiler.stop'); await writeFile(output + '.cpuprofile', JSON.stringify(profile)); }
      if (tracer) {
        const complete = new Promise(resolve => tracer.once('Tracing.tracingComplete', resolve));
        await tracer.send('Tracing.end'); await complete;
        await writeFile(output + '.trace.json', JSON.stringify({ traceEvents: trace }));
      }
      const after = { runtime: runtimeCPU(), app: await metrics(), stats: await api('stats'), time: performance.now() };
      const uiMetrics = await page.evaluate(() => { window.flowerCPU.active = false; return window.flowerCPU; });
      const streamingDOM = await page.evaluate(() => ({ textChunks: document.querySelectorAll('.flower-chat-md-text-chunk').length, codeChunks: document.querySelectorAll('.flower-chat-md-code-chunk').length, tail: [...document.querySelectorAll('.flower-chat-md-content')].at(-1)?.innerHTML.slice(0, 500) }));
      const elapsed = (after.time - before.time) / 1000;
      const processes = after.app.map(item => ({ ...item, percent: 100 * (item.cpu - (before.app.find(prior => prior.pid === item.pid)?.cpu ?? 0)) / elapsed }));
      const percentile = (values, p) => values.sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
      evidence = { threads, hz, seconds: elapsed, warmup, setup, before, after, processes, runtimeCPU: 100 * (after.runtime - before.runtime) / elapsed, rendererCPU: processes.filter(item => item.type === 'Tab').reduce((sum, item) => sum + item.percent, 0), appCPU: processes.reduce((sum, item) => sum + item.percent, 0), frames: { count: uiMetrics.frames.length, p95: percentile(uiMetrics.frames, .95) }, input: { count: uiMetrics.inputs.length, p95: percentile(uiMetrics.inputs, .95) }, click: { count: uiMetrics.clicks.length, p95: percentile(uiMetrics.clicks, .95) }, longTasks: uiMetrics.longTasks, errors };
      evidence.streamingDOM = streamingDOM;
      evidence.combinedCPU = evidence.runtimeCPU + evidence.appCPU;
      evidence.allocationBytes = after.stats.alloc_bytes - before.stats.alloc_bytes;
      evidence.wireBytes = after.stats.wire_bytes - before.stats.wire_bytes;
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
      await api('stop');
      if (idle) {
        evidence.combinedCPU = evidence.runtimeCPU + evidence.appCPU;
        await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
        assert.deepEqual(errors, []);
        assert.ok(evidence.combinedCPU <= 3, 'idle related processes must remain at or below 3% CPU');
        return;
      }
      await page.waitForTimeout(1000);
      const canonical = await Promise.all(configured.threads.map(id => api('evidence', '&id=' + encodeURIComponent(id))));
      assert.ok(canonical.every(run => run.exact_text && run.exact_reasoning), 'canonical content must equal every provider delta');
      const visible = canonical[0];
      const outputDelays = uiMetrics.outputs.flatMap(item => visible.timings[item.index] >= before.wallTime ? [item.at - visible.timings[item.index]] : []);
      const observedIndices = new Set(uiMetrics.outputs.map(item => item.index));
      const expectedIndices = [...visible.text.matchAll(/word(\d{6})/g)].map(match => Number(match[1]))
        .filter(index => visible.timings[index] >= before.wallTime && visible.timings[index] <= before.wallTime + elapsed * 1000 - 150);
      const observedCount = expectedIndices.filter(index => observedIndices.has(index)).length;
      evidence.output = { count: outputDelays.length, p95: percentile(outputDelays, .95), expectedCount: expectedIndices.length, observedCount, coverage: observedCount / expectedIndices.length };
      evidence.display = await page.evaluate(() => ({ textChunks: document.querySelectorAll('.flower-chat-md-text-chunk').length, codeChunks: document.querySelectorAll('.flower-chat-md-code-chunk').length, text: document.querySelector('.flower-transcript-stack')?.textContent?.slice(-2000), selected: document.querySelector('main')?.getAttribute('data-flower-selected-thread-id'), rows: [...document.querySelectorAll('[data-flower-message-id]')].slice(-10).map(node => ({ id: node.getAttribute('data-flower-message-id'), text: node.textContent?.slice(-160) })) }));
      // Inspect after timing; compare every generated item with full parsing.
      const generatedTurn = visible.items.find(item => item.turn_id)?.turn_id;
      const turnSelector = '.flower-turn-row[data-flower-turn-id=' + JSON.stringify(generatedTurn) + ']';
      const summary = page.locator(turnSelector + ' .flower-turn-summary-button').first();
      await page.waitForTimeout(500);
      if (await summary.count() && await summary.getAttribute('aria-expanded') === 'false') await summary.click();
      const { createMarkdownParser } = await import(pathToFileURL(path.join(ui, 'node_modules/@floegence/floe-webapp-core/dist/markdown.js')));
      const { JSDOM } = require('jsdom');
      const markdown = createMarkdownParser({ gfm: true, breaks: false, pedantic: false });
      evidence.rendered = [];
      for (const item of visible.items.filter(item => item.kind === 'assistant' || item.kind === 'thinking')) {
        if (await summary.count() && await summary.getAttribute('aria-expanded') === 'false') await summary.click();
        const row = page.locator('[data-flower-message-id=' + JSON.stringify(item.id) + ']').first();
        await row.waitFor({ timeout: 15000 });
        const toggle = row.locator('.flower-thinking-toggle');
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        const contentSelector = item.kind === 'thinking' ? '.flower-message-plain-text' : '.flower-chat-md-block';
        await row.locator(contentSelector).first().waitFor({ state: 'attached', timeout: 15000 });
        const actual = await row.locator(contentSelector).evaluateAll(nodes => nodes.map(node => {
          const clone = node.cloneNode(true);
          clone.querySelectorAll('.flower-chat-md-code-copy, .flower-chat-md-code-header, .flower-answer-actions').forEach(node => node.remove());
          return clone.textContent;
        }).join(''));
        const expected = item.kind === 'thinking' ? item.text ?? '' : new JSDOM(String(markdown.parse(item.text ?? ''))).window.document.body.textContent ?? '';
        const normalize = value => item.kind === 'thinking' ? value : value.replace(/\s+/gu, ' ').trim();
        const actualCode = await row.locator(contentSelector + ' pre > code').allTextContents();
        const expectedCode = [];
        if (item.kind !== 'thinking') markdown.walkTokens(markdown.lexer(item.text ?? ''), token => { if (token.type === 'code') expectedCode.push(token.text); });
        evidence.rendered.push({ id: item.id, kind: item.kind, actual: hash(normalize(actual)), expected: hash(normalize(expected)), exact: normalize(actual) === normalize(expected) && JSON.stringify(actualCode) === JSON.stringify(expectedCode), codeBlocks: actualCode.length });
      }
      evidence.content = canonical.map(({ timings, text, reasoning, items, ...run }) => ({ ...run, textCharacters: text.length, reasoningCharacters: reasoning.length, itemCount: items.length }));
      evidence.configured = configured;
      assert.ok(evidence.display.rows.length > 0 && evidence.output.count > 0, 'live output must actually render');
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
      console.log(JSON.stringify(evidence));
      assert.ok(evidence.rendered.length > 0 && evidence.rendered.every(item => item.exact), 'every generated item must render its complete canonical Markdown');
      const stopSamples = Number(argument('stop-samples', '0'));
      const stopDelays = [];
      const stopDetails = [];
      if (profiler && stopSamples) await profiler.send('Profiler.start');
      for (let sample = 0; sample < stopSamples; sample++) {
        await api('start', '&threads=1');
        await page.locator('.flower-composer-stop-inline:not(:disabled), [data-flower-primary-action=stop]:not(:disabled)').first().waitFor();
        const stopDetail = await page.locator('.flower-composer-stop-inline:not(:disabled), [data-flower-primary-action=stop]:not(:disabled)').first().evaluate(button => new Promise(resolve => {
          const start = performance.now();
          button.click();
          const synchronous = performance.now() - start;
          requestAnimationFrame(() => resolve({ total: performance.now() - start, synchronous }));
        }));
        stopDelays.push(stopDetail.total);
        stopDetails.push(stopDetail);
        await api('stop');
      }
      if (profiler && stopSamples) { const { profile } = await profiler.send('Profiler.stop'); await writeFile(output + '.stop.cpuprofile', JSON.stringify(profile)); }
      if (stopDelays.length) evidence.stop = { count: stopDelays.length, p95: percentile(stopDelays, .95), samples: stopDetails };
      evidence.combinedCPU = evidence.runtimeCPU + evidence.appCPU;
      evidence.allocationBytes = after.stats.alloc_bytes - before.stats.alloc_bytes;
      evidence.wireBytes = after.stats.wire_bytes - before.stats.wire_bytes;
      evidence.workload = workload;
      evidence.initialBytes = initialBytes;
      await Promise.all(diagnosticReads);
      evidence.consoleErrors = consoleErrors;
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
      assert.ok(evidence.output.coverage >= .95, 'output latency must observe at least 95% of foreground text markers');
      if (process.argv.includes('--candidate-gates')) {
        // Absolute CPU budgets describe the 40 Hz standard workload. Stress
        // retains exact content, provider rate, responsiveness and long-task gates.
        if (hz === 40 && initialBytes === 0) {
          assert.ok(evidence.runtimeCPU <= (threads === 1 ? 30 : 120), 'runtime CPU limit');
          assert.ok(evidence.rendererCPU <= (threads === 1 ? 20 : 30), 'renderer CPU limit');
          assert.ok(evidence.combinedCPU <= (threads === 1 ? 60 : 160), 'combined CPU limit');
        }
        for (const metric of [evidence.input, evidence.click, evidence.output, evidence.stop].filter(Boolean)) assert.ok(metric.count > 0 && metric.p95 <= 100, 'interaction and output p95 limit');
        assert.ok(evidence.frames.p95 <= 20, 'frame p95 limit');
        assert.ok(evidence.longTasks.every(value => value < 100), 'main thread long task limit');
      }
      assert.deepEqual(errors, []);
      assert.ok(!consoleErrors.some(error => error.message.startsWith('Flower thread detail convergence failed.')), 'thread detail must converge without synchronization errors');
      assert.ok(configured.threads.every(id => after.stats.thread_updates[id] - before.stats.thread_updates[id] >= seconds * hz * .95), 'every configured thread must maintain its requested update rate during measurement');
      assert.ok(after.stats.produced - before.stats.produced >= seconds * hz * threads * .95, 'provider must maintain its requested update rate');
    } catch (error) {
      await writeFile(output, JSON.stringify({ ...evidence, failed: String(error) }, null, 2) + '\n');
      console.error(error); throw error;
    }
    finally { await api('stop'); }
  });
}
