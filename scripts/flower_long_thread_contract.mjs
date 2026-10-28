import assert from 'node:assert/strict';

// Fixed acceptance policy. The runner exposes no workload/threshold overrides.
export const workload = Object.freeze({ historyTurns: 500, hz: 80, toolEvery: 60, initialBytes: 32768, warmupSeconds: 120, sampleSeconds: 12 });
export const fastTests = Object.freeze([
  'runtimeThreadRecord.test.ts', 'runtimeThreadRecord.client.test.ts', 'runtimeCurrentView.stability.test.ts', 'flowerTimelineProjection.test.ts', 'flowerLiveFrameQueue.test.ts', 'threadCache.test.ts',
  'historyBodyLoader.test.ts', 'historyBodyLayout.client.test.ts', 'historyWindowRetention.test.ts', 'historyReadingWindow.test.ts', 'flowerTurnDisclosure.test.ts',
  'flowerTurnPresentation.test.ts', 'flowerToolSequences.test.ts', 'flowerToolSequences.client.test.ts', 'flowerPresentationSubscriptions.client.test.ts', 'flowerActivityTitleReveal.client.test.ts', 'flowerSequenceDisclosure.client.test.ts', 'chat/markdown/streamingMarkdownModel.test.ts',
]);
export const browserTests = Object.freeze([
  'FlowerSurface.continuousHistory.browser.test.tsx', 'FlowerSurface.streamingStability.browser.test.tsx',
  'FlowerSurface.reasoningSelection.browser.test.tsx', 'FlowerSurface.disclosureInteraction.browser.test.tsx',
  'FlowerSurface.liveRecovery.browser.test.tsx', 'FlowerSurface.inputResponse.browser.test.tsx',
  'FlowerSurface.decisionSurface.browser.test.tsx', 'FlowerSurface.terminalActivity.browser.test.tsx',
  'FlowerSurface.history.browser.test.tsx', 'FlowerSurface.threadPresentation.browser.test.tsx',
  'FlowerSurface.turnProcess.browser.test.tsx', 'FlowerSurface.toolSequences.browser.test.tsx',
  'FlowerSurface.parentEvents.browser.test.tsx', 'FlowerSurface.activityTyping.browser.test.tsx',
]);
export function longThreadAffected(file) {
  return /^(?:internal\/(?:flower_ui|flower_host_ui|envapp|ai|codeapp|agent)\/|desktop\/|go\.(?:mod|sum)$|\.node-version$|\.githooks\/|scripts\/(?:.*flower.*|local_gate.*|check_final_integration.*|check_quick_ci.*|quick_ci_policy.*|ui_package.*|desktop_test_session.*)|\.github\/workflows\/.*flower.*)/u.test(file);
}
export function distribution(values) {
  if (!Array.isArray(values) || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid metric samples');
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p95: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null, max: sorted.length ? sorted.at(-1) : null };
}
// Chromium async slices can nest under the same process/id/scope. Only spans
// reaching presentation count as presented; coalesced events remain counted.
export function presentedMouseLatency(events) {
  const stacks = new Map(), roots = new Map(), completed = [];
  for (const event of events) {
    if (!['b', 'e'].includes(event.ph) || event.id2 === undefined && event.id === undefined) continue;
    const key = JSON.stringify([event.pid, event.id2 ?? event.id, event.scope]);
    const stack = stacks.get(key) ?? []; stacks.set(key, stack);
    if (event.ph === 'b') {
      stack.push(event);
      if (event.name === 'EventLatency') roots.set(key, { start: event.ts, type: event.args?.event_latency?.event_type, presented: false });
    } else {
      const start = stack.pop(), root = roots.get(key);
      if (!start || start.name !== event.name || !root) continue;
      if (event.name === 'SubmitCompositorFrameToPresentationCompositorFrame') root.presented = true;
      if (event.name === 'EventLatency') { completed.push({ ...root, duration: (event.ts - root.start) / 1000 }); roots.delete(key); }
    }
  }
  const moves = completed.filter(item => item.type === 'MOUSE_DRAGGED');
  return { all: moves.length, unpresented: moves.filter(item => !item.presented).length, ...distribution(moves.filter(item => item.presented).map(item => item.duration)) };
}
export function evaluateLongThread(report) {
  const failures = [];
  const check = (value, message) => { if (!value) failures.push(message); };
  const finite = (value, predicate) => Number.isFinite(value) && predicate(value);
  check(report.setup?.history_verified === true && report.setup.history_turns === workload.historyTurns
    && report.setup.history_messages === 1000 && report.setup.history_completed_activities === 1000, 'verified 500-turn canonical history');
  check(report.canonical?.exact_text === true && report.canonical.exact_reasoning === true && report.canonical.tools >= 160 && report.canonical.exact_tools === true, 'complete canonical text, reasoning and tool workload');
  const ids = report.canonical?.renderedIDs;
  check(Array.isArray(ids) && ids.length >= 320 && new Set(ids).size === ids.length && report.rendered?.length === ids.length && new Set(report.rendered.map(item => item.id)).size === ids.length && report.rendered.every(item => ids.includes(item.id) && item.exact === true), 'every generated prose/reasoning item remains accessible and exact');
  check(Array.isArray(report.errors) && report.errors.length === 0, 'no renderer or synchronization errors');
  const names = ['idle', 'early', 'long', 'repeat'];
  check(report.samples?.length === names.length && names.every(name => report.samples.filter(item => item.name === name).length === 1), 'complete unique idle/early/long/repeat samples');
  const idle = report.samples?.find(item => item.name === 'idle');
  for (const sample of report.samples ?? []) {
    const label = sample.name + ': ';
    check(finite(sample.seconds, value => value >= workload.sampleSeconds), label + 'complete measurement duration');
    check(sample.visible === true && sample.active === 'drag', label + 'visible composited window and active native drag');
    check(sample.draftPreserved === true && sample.focusPreserved === true && sample.selectionPreserved === true, label + 'draft, focus and selection continuity');
    check(finite(sample.sent, value => value / sample.seconds >= 55), label + 'independently offered input rate >=55Hz');
    check(finite(sample.commits, value => value / sample.seconds >= 45), label + 'actual position commits >=45Hz');
    check(finite(sample.presented?.count, value => value >= sample.seconds * 30), label + 'sufficient compositor presentation samples');
    check(finite(sample.presented?.p95, value => value <= 75), label + 'presented drag P95 <=75ms');
    check(finite(sample.frames?.p95, value => value <= 25) && sample.frames?.count >= sample.seconds * 30, label + 'frame interval P95 <=25ms');
    check(sample.longTasks?.count === 0 || finite(sample.longTasks?.max, value => value < 100), label + 'no main-thread task >=100ms');
    check(Array.isArray(sample.inputErrors) && sample.inputErrors.length === 0, label + 'no input dispatch failures');
    check(Array.isArray(sample.interruptions) && sample.interruptions.length === 0, label + 'uninterrupted pointer and window ownership');
    if (sample.name === 'idle') continue;
    check(finite(sample.updates, value => value / sample.seconds >= workload.hz * .95), label + 'provider maintains >=95% of 80Hz');
    check(sample.output?.count > 0 && sample.output.coverage >= .95 && finite(sample.output.p95, value => value <= 250), label + '>=95% live prose markers visible within P95 250ms');
    check(sample.queue?.count > 0 && finite(sample.queue.p95, value => value <= 12) && finite(sample.queue.max, value => value <= 50), label + 'reactive apply P95 <=12ms and max <=50ms');
    check(finite(sample.presented?.p95 - idle?.presented?.p95, value => value <= 25), label + 'presentation penalty <=25ms over idle');
    check(finite(sample.commits / sample.seconds, value => value >= .8 * (idle?.commits / idle?.seconds)), label + 'retain >=80% of idle drag cadence');
    if (['long', 'repeat'].includes(sample.name)) check(sample.generationSeconds >= workload.warmupSeconds && sample.producedBefore >= workload.hz * workload.warmupSeconds * .95, label + 'sustained active-turn accumulation');
  }
  return { passed: failures.length === 0, failures };
}
export function assertLongThread(report) {
  const acceptance = evaluateLongThread(report);
  assert.equal(acceptance.passed, true, acceptance.failures.join('\n'));
}
