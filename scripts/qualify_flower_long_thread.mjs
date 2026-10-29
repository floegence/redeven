import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDesktopTestSession } from './desktop_test_session.mjs';
import { workload, distribution, presentedMouseLatency, evaluateLongThread, assertLongThread } from './flower_long_thread_contract.mjs';
import { collectDrag } from './flower_long_thread_collector.mjs';
import { verifyFlowerRendered } from './qualify_flower_content.mjs';

assert.equal(process.argv.length, 2, 'The fixed acceptance workload has no reduced-load or threshold overrides');
const root = path.resolve(import.meta.dirname, '..');
const ui = path.join(root, 'internal/envapp/ui_src');
const require = createRequire(path.join(ui, 'package.json'));
const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
const { _electron: electron } = require('playwright');
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 1800000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = await mkdtemp(path.join(tmpdir(), 'flower-long-thread-evidence-'));
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).length > 0;
console.log('Long-thread evidence: ' + output);
await session.run(async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-long-thread-runtime-'));
  await session.directory(temporary);
  const dist = path.join(temporary, 'dist'), state = path.join(temporary, 'state');
  await mkdir(state);
  const log = createWriteStream(path.join(output, 'runtime.log'));
  await session.defer('runtime log', () => new Promise(resolve => log.end(resolve)));
  const build = await session.spawn(process.execPath, ['scripts/qualify_flower_cpu.mjs', '--build', '--dist=' + dist], { cwd: root, stdio: 'inherit' }, { kind: 'qualification-build', allowCleanExit: true });
  await session.wait(build, 120000);
  assert.equal(build.exitCode, 0, 'Build current production UI');
  const fixture = await session.spawn('go', ['test', './internal/ai', '-run', '^TestFlowerCPUQualification$', '-count=1', '-v', '-timeout=25m'], {
    cwd: root, env: { ...process.env, GOWORK: 'off', REDEVEN_CPU_QUALIFICATION: '1', REDEVEN_CPU_STATE: state, REDEVEN_CPU_DIST: dist,
      REDEVEN_CPU_RETAIN_SEED_SCOPE: '0', REDEVEN_CPU_CHILD_DETAIL: '0', REDEVEN_CPU_SEED_ONLY: '0', REDEVEN_CPU_SYSTEM_PROMPT_BYTES: '', REDEVEN_CPU_HISTORY_TURNS: String(workload.historyTurns), REDEVEN_CPU_TOOL_EVERY: String(workload.toolEvery) }, stdio: ['ignore', 'pipe', 'pipe'],
  }, { kind: 'synthetic-flower-runtime', allowCleanExit: true });
  fixture.stdout.pipe(log, { end: false }); fixture.stderr.pipe(log, { end: false });
  let info;
  const preparationStarted = Date.now();
  const deadline = preparationStarted + 1200000;
  let lastPreparationNotice = 0;
  while (!info) {
    try { info = JSON.parse(await readFile(path.join(state, 'fixture.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (info) break;
    assert.equal(fixture.exitCode, null, 'Runtime fixture must remain alive; inspect runtime.log');
    assert.ok(Date.now() < deadline, 'Canonical history preparation deadline');
    if (Date.now() - lastPreparationNotice >= 30000) {
      console.log('Preparing 500 canonical history turns: ' + Math.floor((Date.now() - preparationStarted) / 1000) + 's');
      lastPreparationNotice = Date.now();
    }
    await sleep(500);
  }
  const fixtureURL = new URL(info.url);
  assert.equal(fixtureURL.protocol, 'http:');
  assert.equal(fixtureURL.hostname, '127.0.0.1');
  assert.equal(fixtureURL.username + fixtureURL.password + fixtureURL.search + fixtureURL.hash, '');
  assert.equal(fixtureURL.pathname, '/');
  assert.ok(fixtureURL.port);
  const fixtureOrigin = 'http://127.0.0.1:' + Number(fixtureURL.port);
  await session.port(Number(fixtureURL.port));
  const api = async (op, extra = '') => {
    const response = await fetch(fixtureOrigin + '/fixture?op=' + op + extra, { signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, op + ': ' + (response.ok ? '' : await response.text()));
    return response.json();
  };
  await session.setGracefulClose(fixture, async () => { await api('quit'); await session.wait(fixture, 20000); });
  const setup = await api('setup');
  const configured = await api('configure', '&threads=1&hz=' + workload.hz + '&mode=mixed&initial_bytes=' + workload.initialBytes);
  console.log('Canonical history verified: ' + JSON.stringify(setup));
  const application = await session.launchElectron(electron, {
    executablePath: desktopRequire('electron'), args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), '--redeven-smoke-run=long-thread-gate'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: path.join(temporary, 'profile'), FLOWER_PERF_URL: info.url + '/?cpu=1&long-thread=1&thread=' + configured.threads[0] },
  });
  const page = await application.firstWindow();
  // Native pointer motion on a shared desktop must not release the independent
  // CDP drag. Keep the real visible compositor and renderer input path; only
  // prevent unrelated physical mouse events from entering this test window.
  const nativeWindow = await application.browserWindow(page);
  await nativeWindow.evaluate(window => window.setIgnoreMouseEvents(true));
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400) errors.push({ status: response.status(), url: response.url(), at: Date.now() });
  });
  await page.locator('.flower-composer textarea').waitFor({ timeout: 60000 });
  await page.locator('[data-flower-message-id]').first().waitFor({ state: 'attached' });
  await page.locator('.flower-composer textarea').fill('Keep the Flower draft');
  await page.locator('#open-output').click(); await page.locator('#open-preview').click();
  await page.locator('[aria-label="Preview draft"]').fill('Keep the preview draft');
  const cdp = await application.context().newCDPSession(page);
  const samples = [];
  const report = { setup, configured, samples, errors, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    tree: process.env.LOCAL_GATE_TREE ?? null, sourceDirty, node: process.version, host: { platform: platform(), release: release(), cpu: cpus()[0]?.model }, locks: {} };
  for (const file of ['go.sum', 'desktop/pnpm-lock.yaml', 'internal/envapp/ui_src/pnpm-lock.yaml']) report.locks[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
  let generationStarted = 0;
  let fixtureClosed = false;
  const sample = async name => {
    assert.ok(['idle', 'early', 'long', 'repeat'].includes(name));
    await page.bringToFront();
    const titlebar = page.locator('[data-floe-floating-window-titlebar]').filter({ hasText: 'Long-thread preview' });
    await page.locator('[aria-label="Preview draft"]').evaluate(node => { node.focus({ preventScroll: true }); node.setSelectionRange(5, 12); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = await titlebar.boundingBox(); assert.ok(box);
    const x = box.x + Math.min(140, box.width / 2), y = box.y + 12;
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,input,cc,benchmark', transferMode: 'ReturnAsStream' });
    const before = await api('stats');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-floe-hot-interaction') === 'drag', undefined, { timeout: 2000 });
    await page.evaluate(collectDrag);
    const inputErrors = [], pending = new Set();
    let sent = 0;
    const start = Date.now(), monotonicStart = performance.now();
    const interval = setInterval(() => {
      const phase = (performance.now() - monotonicStart) / 1000;
      sent++;
      // Let Chromium timestamp input on its own monotonic clock. A Node wall
      // clock can drift past renderer processing and corrupt EventLatency spans.
      const request = cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + Math.sin(phase * 2) * 110, y: y + Math.sin(phase * 1.3) * 70, button: 'left', buttons: 1, pointerType: 'mouse' })
        .catch(error => inputErrors.push(String(error))).finally(() => pending.delete(request));
      pending.add(request);
    }, 1000 / 60);
    let seconds;
    try {
      const deadline = monotonicStart + workload.sampleSeconds * 1000;
      while (performance.now() < deadline) await sleep(deadline - performance.now());
      seconds = (performance.now() - monotonicStart) / 1000;
    }
    finally { clearInterval(interval); await Promise.all(pending); }
    const state = await page.evaluate(() => ({ hot: document.documentElement.getAttribute('data-floe-hot-interaction'), visible: document.visibilityState === 'visible',
      draftPreserved: document.querySelector('[aria-label="Preview draft"]')?.value === 'Keep the preview draft' && document.querySelector('.flower-composer textarea')?.value === 'Keep the Flower draft',
      nodes: document.querySelectorAll('*').length, ...window.__flowerLongThreadDrag.stop() }));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    const after = await api('stats');
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await done;
    let raw = '';
    try { for (;;) { const part = await cdp.send('IO.read', { handle: stream }); raw += part.data; if (part.eof) break; } }
    finally { await cdp.send('IO.close', { handle: stream }); }
    await writeFile(path.join(output, name + '-trace.json'), raw);
    const result = { name, seconds, sent, inputErrors, interruptions: state.interruptions, active: state.hot, visible: state.visible, draftPreserved: state.draftPreserved, focusPreserved: state.focusPreserved, selectionPreserved: state.selectionPreserved,
      startedAt: start, outputs: state.outputs, commits: state.commits.length, nodes: state.nodes, presented: presentedMouseLatency(JSON.parse(raw).traceEvents), frames: distribution(state.frames.map(item => item.delta).filter(value => value > 0)),
      longTasks: distribution(state.tasks.map(item => item.duration)), queue: distribution(state.queues.map(item => item.durationMs)), updates: after.produced - before.produced,
      producedBefore: before.produced, generationSeconds: generationStarted ? (monotonicStart - generationStarted) / 1000 : 0 };
    samples.push(result);
    await writeFile(path.join(output, name + '-measurements.json'), JSON.stringify(state));
    await writeFile(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...result, outputs: result.outputs.length }));
  };
  try {
    await sleep(1000); await sample('idle');
    await api('start', '&threads=1'); generationStarted = performance.now();
    await sleep(5000); await sample('early');
    while (performance.now() - generationStarted < workload.warmupSeconds * 1000) {
      await sleep(Math.min(15000, workload.warmupSeconds * 1000 - (performance.now() - generationStarted)));
      console.log('Active-turn accumulation: ' + JSON.stringify(await api('stats')));
    }
    await sample('long'); await sample('repeat');
    await api('stop');
    // Backend completion can precede consumption of the queued final snapshot.
    // Wait for the observed terminal state before navigating folded content.
    await page.locator('main[data-flower-selected-thread-status="success"]').waitFor({ timeout: 60000 });
    const canonical = await api('evidence', '&id=' + configured.threads[0]);
    for (const measured of samples.filter(item => item.name !== 'idle')) {
      const expected = [...canonical.text.matchAll(/word(\d{6})/g)].map(match => Number(match[1])).filter(index => canonical.timings[index] >= measured.startedAt && canonical.timings[index] <= measured.startedAt + measured.seconds * 1000 - 250);
      const observed = new Map(measured.outputs.map(item => [item.index,item.at]));
      const delays = expected.filter(index => observed.has(index)).map(index => observed.get(index) - canonical.timings[index]);
      measured.output = { ...distribution(delays), expected: expected.length, coverage: expected.length ? delays.length / expected.length : 0 };
    }
    const tools = canonical.items.filter(item => item.kind === 'tool');
    report.canonical = { exact_text: canonical.exact_text, exact_reasoning: canonical.exact_reasoning, updates: canonical.updates, tools: tools.length, exact_tools: tools.length === Math.floor(canonical.updates / workload.toolEvery) && tools.every((item, index) => item.activity?.status === 'success' && item.activity.tool_id === 'live-' + ((index + 1) * workload.toolEvery)), renderedIDs: canonical.items.filter(item => ['assistant', 'thinking'].includes(item.kind)).map(item => item.id) };
    await writeFile(path.join(output, 'canonical.json'), JSON.stringify(canonical));
    await writeFile(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2));
    console.log('Checking complete rendered content: ' + report.canonical.renderedIDs.length + ' items');
    // Close unrelated overlays before inspecting all canonical generated rows.
    await page.locator('[data-floe-floating-window-titlebar]').filter({ hasText: 'Long-thread preview' }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-floe-floating-window-titlebar]').filter({ hasText: 'Synthetic build output' }).getByRole('button', { name: 'Close', exact: true }).click();
    report.rendered = await verifyFlowerRendered({ page, visible: canonical, ui, output: path.join(output, 'content') });
    report.acceptance = evaluateLongThread(report);
    await page.screenshot({ path: path.join(output, 'completed.png') });
    await session.closeElectron(application);
    await api('quit'); await session.wait(fixture, 20000); fixtureClosed = true;
    await session.writeEvidence(path.join(output, 'metrics.json'), report);
    assertLongThread(report);
  } catch (error) {
    report.failure = String(error);
    report.acceptance = evaluateLongThread(report);
    await page.screenshot({ path: path.join(output, 'failed.png') }).catch(() => {});
    await page.content().then(html => writeFile(path.join(output, 'failed.dom.html'), html)).catch(() => {});
    await session.writeEvidence(path.join(output, 'metrics.json'), report);
    throw error;
  } finally { if (!fixtureClosed) await api('stop'); }
});
