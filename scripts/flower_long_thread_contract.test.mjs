import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { evaluateLongThread, distribution, presentedMouseLatency, longThreadAffected, fastTests, browserTests } from './flower_long_thread_contract.mjs';
import { affected, runGate } from './check_flower_long_thread.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('only the long-thread host isolates native input before showing its visible window', async () => {
  for (const isolated of [false, true]) {
    const calls = [], listeners = new Map();
    let options, ready;
    const app = { setPath() {}, on() {}, quit() {}, whenReady: () => ({ then: callback => { ready = callback; } }) };
    class BrowserWindow {
      constructor(value) { options = value; this.webContents = { on: (name, listener) => listeners.set(name, listener) }; }
      setIgnoreMouseEvents(value) { calls.push(['ignoreMouse', value]); }
      showInactive() { calls.push(['showInactive']); }
      async loadURL(value) { calls.push(['load', value]); }
    }
    vm.runInNewContext(read('internal/flower_ui/testing/performance/desktop.cjs'), {
      require: name => { assert.equal(name, 'electron'); return { app, BrowserWindow }; },
      process: { argv: isolated ? ['--redeven-smoke-run=long-thread-gate'] : ['--redeven-smoke-run=flower-cpu'],
        env: { FLOWER_PERF_PROFILE: '/test-profile', FLOWER_PERF_URL: 'http://127.0.0.1:12345' } },
    });
    await ready();
    assert.equal(options.show, !isolated);
    assert.equal(options.focusable, isolated ? false : undefined);
    assert.deepEqual(calls, isolated ? [['ignoreMouse', true], ['showInactive'], ['load', 'http://127.0.0.1:12345']] : [['load', 'http://127.0.0.1:12345']]);
    assert.equal(listeners.has('before-mouse-event'), false, 'Do not filter injected pointer events or hide interruptions');
    let prevented = false;
    listeners.get('before-input-event')?.({ preventDefault() { prevented = true; } });
    assert.equal(prevented, isolated);
  }
});
function valid() {
  return { setup: { history_verified: true, history_turns: 500, history_messages: 1000, history_completed_activities: 1000 },
    canonical: { exact_text: true, exact_reasoning: true, tools: 190, exact_tools: true, renderedIDs: Array.from({ length: 380 }, (_, i) => String(i)) }, rendered: Array.from({ length: 380 }, (_, i) => ({ id: String(i), exact: true })), errors: [],
    samples: ['idle', 'early', 'long', 'repeat'].map(name => ({ name, seconds: 12, visible: true, active: 'drag', draftPreserved: true, focusPreserved: true, selectionPreserved: true,
      sent: 720, commits: 680, presented: { count: 650, p95: name === 'idle' ? 40 : 55 }, frames: { count: 700, p95: 18 }, longTasks: { count: 0, max: null },
      output: { count: 650, coverage: .99, p95: 100 }, queue: { count: 150, p95: 8, max: 20 }, updates: 960, inputErrors: [], interruptions: [], generationSeconds: 125, producedBefore: 10000 })) };
}
test('acceptance rejects missing evidence, short workloads and every correctness/performance regression', () => {
  assert.equal(evaluateLongThread(valid()).passed, true);
  for (const mutate of [
    r => r.samples.pop(), r => r.samples.push(r.samples[0]), r => r.setup.history_verified = false,
    r => r.canonical.exact_tools = false, r => r.rendered[1].id = r.rendered[0].id, r => r.canonical.exact_text = false, r => r.canonical.exact_reasoning = false, r => r.canonical.tools = 3,
    r => r.rendered.pop() && (r.rendered[0].exact = false), r => r.rendered = [], r => r.errors.push('renderer error'),
    ...['visible','draftPreserved','focusPreserved','selectionPreserved'].map(key => r => r.samples[2][key] = false),
    r => r.samples[2].active = 'true', r => r.samples[2].sent = 300, r => r.samples[2].commits = 250,
    r => r.samples[2].updates = 500, r => r.samples[2].generationSeconds = 10, r => r.samples[2].producedBefore = 100,
    r => r.samples[2].queue.p95 = 70, r => r.samples[2].queue.max = 51, r => r.samples[2].presented.p95 = 110,
    r => r.samples[2].presented.count = 0, r => r.samples[2].presented.p95 = null, r => r.samples[2].frames.p95 = 66,
    r => r.samples[2].longTasks = { count: 1, max: 100 }, r => r.samples[2].inputErrors.push('CDP failed'),
    r => r.samples[0].interruptions.push({ type: 'blur' }), r => delete r.samples[2].interruptions,
    r => r.samples[2].seconds = 1, r => r.samples[2].output.coverage = .5, r => r.samples[2].output.p95 = 900,
  ]) { const report = valid(); mutate(report); assert.equal(evaluateLongThread(report).passed, false, mutate.toString()); }
  assert.equal(evaluateLongThread({}).passed, false);
});
test('the measured long-active-turn regression cannot satisfy the gate', () => {
  const report = valid();
  Object.assign(report.samples[0], { seconds: 16, sent: 960, commits: 914, presented: { count: 914, p95: 41.841 }, frames: { count: 950, p95: 18.4 } });
  Object.assign(report.samples[2], { seconds: 20, sent: 1200, commits: 428, presented: { count: 427, p95: 110.013 }, frames: { count: 500, p95: 66.5 }, queue: { count: 200, p95: 70.9, max: 90 }, updates: 1600 });
  const result = evaluateLongThread(report);
  assert.equal(result.passed, false);
  for (const failure of ['actual position commits', 'presented drag P95', 'frame interval P95', 'reactive apply P95', 'presentation penalty']) assert.ok(result.failures.some(value => value.includes(failure)), failure);
});
test('trace excludes coalesced spans from presentation quantiles but counts them', () => {
  const event = (name, ph, ts, id = 1, pid = 1) => ({ name, ph, ts, id2: { local: id }, pid, args: { event_latency: { event_type: 'MOUSE_DRAGGED' } } });
  const trace = [event('EventLatency','b',0), event('EventLatency','b',0,1,2), event('EventLatency','e',2000,1,2),
    event('SubmitCompositorFrameToPresentationCompositorFrame','b',10000), event('SubmitCompositorFrameToPresentationCompositorFrame','e',20000), event('EventLatency','e',30000),
    event('EventLatency','b',40000,2), event('EventLatency','e',45000,2)];
  assert.deepEqual(presentedMouseLatency(trace), { all: 3, unpresented: 2, count: 1, p95: 30, max: 30 });
  assert.equal(presentedMouseLatency([]).p95, null);
  assert.throws(() => distribution([NaN]));
});
test('scope covers projection, transports, host widgets, published locks and gate mutations', () => {
  for (const file of ['internal/flower_ui/src/FlowerSurface.tsx','internal/ai/flower_live_stream.go','internal/envapp/ui_src/pnpm-lock.yaml','desktop/pnpm-lock.yaml','go.mod','go.sum','.node-version','scripts/qualify_flower_content.mjs','.githooks/pre-push']) assert.ok(longThreadAffected(file), file);
  assert.equal(longThreadAffected('README.md'), false);
  assert.equal(affected(['--staged'], () => ({ status: 0, stdout: 'go.sum\0' })), true);
  assert.throws(() => affected(['--staged'], () => ({ status: 1 })));
  assert.throws(() => affected(['--skip-performance']));
});
test('runner requires installed suites and propagates missing tools, signals and failed tests', () => {
  for (const result of [{ status: 1 }, { status: null }, { error: new Error('missing executable') }]) assert.throws(() => runGate({ execute: () => result, exists: () => true }));
  assert.throws(() => runGate({ execute: () => ({ status: 0 }), exists: () => false }));
  const calls = []; runGate({ execute: (_command, args) => { calls.push(args); return { status: 0 }; }, exists: () => true });
  assert.ok(calls.some(args => args.includes('scripts/qualify_flower_long_thread.mjs')));
  assert.ok(calls.some(args => args.includes('vitest.browser.config.ts')));
  for (const file of fastTests) assert.ok(existsSync(new URL('../internal/flower_ui/src/' + file, import.meta.url)), file);
  for (const file of browserTests) assert.ok(existsSync(new URL('../internal/envapp/ui_src/src/ui/' + file, import.meta.url)), file);
});
test('long-thread qualification stays explicit and retains complete native-input evidence', () => {
  const manifest = JSON.parse(read('scripts/local_gate_groups.json'));
  for (const groups of Object.values(manifest.profiles)) {
    assert.ok(groups.every(group => !group.startsWith('flower-long-thread')));
  }
  assert.ok(manifest.groups.every(group => !group.id.startsWith('flower-long-thread')
    && !group.command.some(value => /flower[_-]long[_-]thread/u.test(value))));
  for (const file of ['.githooks/pre-commit', '.githooks/pre-push', 'scripts/local_gate_commit_checks.sh',
    'scripts/check_quick_ci.sh', 'scripts/check_final_integration.sh']) {
    assert.doesNotMatch(read(file), /flower[_-]long[_-]thread/u, file);
  }
  const runner = read('scripts/qualify_flower_long_thread.mjs');
  assert.match(runner, /assertLongThread\(report\)/u);
  assert.match(runner, /nativeWindow[.]evaluate[(]window => window[.]setIgnoreMouseEvents[(]true[)][)]/u);
  assert.ok(runner.indexOf("const before = await api('stats')") < runner.indexOf("type: 'mousePressed'"));
  assert.doesNotMatch(runner, /page[.]mouse[.](?:down|up)/u);
  assert.doesNotMatch(runner, /timestamp:/u);
  assert.match(runner, /await session.run\(/u);
  assert.doesNotMatch(runner, /--ref|headless: true|--candidate-gates/u);
});
