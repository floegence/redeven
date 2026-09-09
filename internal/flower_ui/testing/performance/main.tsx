import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../src/composer/createFlowerComposerDraftCoordinator';
import { streamingFixture } from '../streamingFixture';
import '../../../../desktop/src/welcome/index.css';

declare global {
  interface Window {
    flowerPerformance: ReturnType<typeof setup>;
    __flowerPerfCounts: { parses: number; lexes: number };
  }
}
window.__flowerPerfCounts = { parses: 0, lexes: 0 };
function setup() {
  const query = new URLSearchParams(location.search);
  const fixture = streamingFixture(Number(query.get('messages') || 72), Number(query.get('tools') || 20));
  const root = document.getElementById('root')!;
  root.style.height = '100vh';
  const dispose = render(() => <FloeProvider><FlowerSurface adapter={fixture.adapter} draftCoordinator={createFlowerComposerDraftCoordinator()} focusThreadRequest={{ request_id: 'fixture-focus', thread_id: fixture.thread.thread_id }} /></FloeProvider>, root);
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let raf = 0;
  let previousFrame = 0;
  const frames: number[] = [];
  const clicks: number[] = [];
  const longTasks: number[] = [];
  let additions = 0; let removals = 0; let protectedChanges = 0;
  let protectedRoot: Element | null | undefined;
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      additions += record.addedNodes.length; removals += record.removedNodes.length;
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (element && protectedRoot?.contains(element)) protectedChanges += record.addedNodes.length + record.removedNodes.length;
    }
  });
  const tasks = new PerformanceObserver((list) => { if (running) longTasks.push(...list.getEntries().map((entry) => entry.duration)); });
  tasks.observe({ type: 'longtask', buffered: false });
  const clicked = (event: Event) => {
    if (!running || !(event.target instanceof Element) || !event.target.closest('[data-flower-disclosure-trigger]')) return;
    const start = event.timeStamp;
    requestAnimationFrame(() => requestAnimationFrame(() => { clicks.push(performance.now() - start); }));
  };
  root.addEventListener('click', clicked, true);
  let callsBefore = { ...fixture.calls };
  return {
    start(hz: number) {
      window.__flowerPerfCounts.parses = 0; window.__flowerPerfCounts.lexes = 0;
      callsBefore = { ...fixture.calls };
      protectedRoot = root.querySelector('[data-flower-queued-turn-dock-id]')?.parentElement;
      running = true; mutations.observe(root, { childList: true, subtree: true });
      const frame = (timestamp: number) => { if (!running) return; if (previousFrame) frames.push(timestamp - previousFrame); previousFrame = timestamp; raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
      interval = setInterval(() => fixture.append(' token'), 1000 / hz);
    },
    stop() {
      running = false; clearInterval(interval); cancelAnimationFrame(raf); mutations.disconnect();
      const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
      return { frames, clicks, longTasks, frameP95: percentile(frames, .95), clickP95: percentile(clicks, .95), maxLongTask: Math.max(0, ...longTasks), additions, removals, protectedChanges,
        parsers: { ...window.__flowerPerfCounts }, calls: fixture.calls, callsBefore, domElements: root.querySelectorAll('*').length, version: fixture.current().view_version, userAgent: navigator.userAgent };
    },
    dispose() { running = false; clearInterval(interval); cancelAnimationFrame(raf); mutations.disconnect(); tasks.disconnect(); root.removeEventListener('click', clicked, true); dispose(); },
  };
}
window.flowerPerformance = setup();
