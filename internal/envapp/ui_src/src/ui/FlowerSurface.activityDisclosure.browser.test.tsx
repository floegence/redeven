import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerTerminalProcessSnapshot,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function activityThread(status: 'running' | 'success'): FlowerThreadSnapshot {
  const running = status === 'running';
  return thread({
    thread_id: 'thread-browser-disclosure',
    title: 'Browser disclosure rhythm',
    status: running ? 'running' : 'success',
    messages: [{
      id: 'm-browser-disclosure',
      role: 'assistant',
      content: running ? 'Running browser checks.' : 'Browser checks passed.',
      status: 'complete',
      created_at_ms: 10_000,
      blocks: [
        { type: 'markdown', content: running ? 'Running browser checks.' : 'Browser checks passed.' },
        activityTimeline({
          run_id: 'run-browser-disclosure',
          turn_id: 'm-browser-disclosure',
          status,
          severity: running ? 'normal' : 'quiet',
          needs_attention: running,
          items: [activityItem({
            item_id: 'tool-browser-disclosure',
            tool_id: 'tool-browser-disclosure',
            tool_name: 'terminal.exec',
            status,
            severity: running ? 'normal' : 'quiet',
            needs_attention: running,
            label: 'pnpm test:browser',
            renderer: 'terminal',
            payload: {
              command: 'pnpm test:browser',
              output: running ? 'running disclosure checks\n' : 'browser checks passed\n',
              exit_code: running ? undefined : 0,
            },
          })],
        }),
      ],
    }],
  });
}

function renderDisclosureThread() {
  const runningThread = activityThread('running');
  const completeThread = activityThread('success');
  let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
  const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? runningThread : completeThread));
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => listSnapshot),
    loadThread,
  });
  const complete = async () => {
    listSnapshot = [completeThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'success');
  };
  return { runtime, complete };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function streamingActivityThread(): FlowerThreadSnapshot {
  return thread({
    thread_id: 'thread-browser-disclosure',
    title: 'Streaming disclosure rhythm',
    status: 'running',
    active_run_id: 'run-browser-disclosure',
    messages: [{
      id: 'm-browser-disclosure',
      role: 'assistant',
      content: 'Running streaming browser checks.',
      status: 'streaming',
      created_at_ms: 10_000,
      blocks: [
        { type: 'markdown', content: 'Running streaming browser checks.' },
        activityTimeline({
          run_id: 'run-browser-disclosure',
          turn_id: 'm-browser-disclosure',
          status: 'running',
          severity: 'normal',
          needs_attention: true,
          items: [activityItem({
            item_id: 'tool-browser-disclosure',
            tool_id: 'tool-browser-disclosure',
            tool_name: 'terminal.exec',
            status: 'running',
            severity: 'normal',
            needs_attention: true,
            label: 'pnpm test:browser',
            renderer: 'terminal',
            payload: {
              command: 'pnpm test:browser',
              process_id: 'tp-browser-disclosure',
              status: 'running',
            },
          })],
        }),
      ],
    }],
  });
}

function outputLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `stream line ${index + 1}`).join('\n');
}

function sampleHeights(element: HTMLElement, durationMs: number): Promise<number[]> {
  return new Promise((resolve) => {
    const values: number[] = [];
    const startedAt = performance.now();
    const sample = (timestamp: number) => {
      values.push(element.getBoundingClientRect().height);
      if (timestamp - startedAt < durationMs) {
        requestAnimationFrame(sample);
        return;
      }
      resolve(values);
    };
    requestAnimationFrame(sample);
  });
}

async function selectDisclosureThread(runtime: HTMLElement): Promise<HTMLButtonElement> {
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-browser-disclosure"] button')));
  (runtime.querySelector('[data-thread-id="thread-browser-disclosure"] button') as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'running');
  return runtime.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
}

const disclosureInterventions = ['pointerdown', 'focusin', 'wheel', 'touchstart'] as const;

function dispatchDisclosureIntervention(target: HTMLElement, intervention: typeof disclosureInterventions[number]): void {
  if (intervention === 'wheel') {
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -24 }));
    return;
  }
  if (intervention === 'focusin') {
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return;
  }
  target.dispatchEvent(new Event(intervention, { bubbles: true }));
}

describe('Flower activity disclosure browser behavior', () => {
  it('never mounts details for activity that settles inside the open delay', async () => {
    await page.viewport(1440, 900);
    const { runtime, complete } = renderDisclosureThread();
    const button = await selectDisclosureThread(runtime);
    let detailMounts = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('.flower-activity-inline-details') || node.querySelector('.flower-activity-inline-details'))) {
            detailMounts += 1;
          }
        }
      }
    });
    observer.observe(runtime, { childList: true, subtree: true });

    expect(button.getAttribute('aria-expanded')).toBe('false');
    await complete();
    await wait(500);
    observer.disconnect();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(runtime.querySelector('.flower-activity-inline-details')).toBeNull();
    expect(detailMounts).toBe(0);
  });

  it('opens sustained activity at real height and holds completion before closing', async () => {
    await page.viewport(1440, 900);
    const { runtime, complete } = renderDisclosureThread();
    const button = await selectDisclosureThread(runtime);

    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    await waitFor(() => runtime.querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    const desktopDetails = runtime.querySelector('.flower-activity-inline-details') as HTMLElement;
    expect(desktopDetails.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(desktopDetails.style.height).toMatch(/^\d+(?:\.\d+)?px$/);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

    await page.viewport(768, 900);
    const narrowDetails = runtime.querySelector('.flower-activity-inline-details') as HTMLElement;
    expect(narrowDetails.scrollWidth).toBeLessThanOrEqual(narrowDetails.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

    await complete();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await wait(1050);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => button.getAttribute('aria-expanded') === 'false');
    expect(runtime.querySelector('.flower-activity-inline-details')?.getAttribute('data-state')).toBe('closing');
    await waitFor(() => runtime.querySelector('.flower-activity-inline-details') === null);
  });

  it.each(disclosureInterventions)('keeps automatically opened detail pinned after %s intervention', async (intervention) => {
    await page.viewport(1440, 900);
    const { runtime, complete } = renderDisclosureThread();
    const button = await selectDisclosureThread(runtime);

    await waitFor(() => runtime.querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    const details = runtime.querySelector('.flower-activity-inline-details') as HTMLElement;
    dispatchDisclosureIntervention(details, intervention);

    await complete();
    await wait(1350);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(details.getAttribute('data-state')).toBe('open');
  });

  it('animates streamed terminal growth and pauses local tail following after user scroll', async () => {
    await page.viewport(1440, 900);
    const runningThread = streamingActivityThread();
    const secondSnapshot = deferred<FlowerTerminalProcessSnapshot>();
    const finalSnapshot = deferred<FlowerTerminalProcessSnapshot>();
    const readTerminalProcess = vi.fn(async () => {
      const call = readTerminalProcess.mock.calls.length;
      if (call === 1) {
        return {
          process_id: 'tp-browser-disclosure',
          status: 'running',
          output: outputLines(2),
          last_seq: 2,
        };
      }
      if (call === 2) return secondSnapshot.promise;
      return finalSnapshot.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      readTerminalProcess,
    });
    const button = await selectDisclosureThread(runtime);
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    await waitFor(() => runtime.textContent?.includes('stream line 2') === true);
    await waitFor(() => readTerminalProcess.mock.calls.length >= 2);

    const details = runtime.querySelector('.flower-activity-inline-details') as HTMLElement;
    const output = runtime.querySelector('.flower-activity-terminal-output') as HTMLElement;
    const initialHeight = details.getBoundingClientRect().height;
    const heightSamplesPromise = sampleHeights(details, 460);
    secondSnapshot.resolve({
      process_id: 'tp-browser-disclosure',
      status: 'running',
      output: outputLines(36),
      last_seq: 36,
    });

    await waitFor(() => runtime.textContent?.includes('stream line 36') === true);
    const heightSamples = await heightSamplesPromise;
    const finalHeight = details.getBoundingClientRect().height;
    const roundedSamples = new Set(heightSamples.map((value) => Math.round(value * 2) / 2));
    expect(finalHeight).toBeGreaterThan(initialHeight + 20);
    expect(roundedSamples.size).toBeGreaterThan(4);
    expect(heightSamples.some((value) => value > initialHeight + 1 && value < finalHeight - 1)).toBe(true);
    expect(output.scrollHeight - output.scrollTop - output.clientHeight).toBeLessThanOrEqual(2);

    output.scrollTop = 0;
    output.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
    output.dispatchEvent(new Event('scroll', { bubbles: true }));
    await page.viewport(768, 900);
    await wait(40);
    const narrowCappedHeight = details.getBoundingClientRect().height;
    finalSnapshot.resolve({
      process_id: 'tp-browser-disclosure',
      status: 'success',
      output: outputLines(52),
      last_seq: 52,
      exit_code: 0,
    });

    await waitFor(() => runtime.textContent?.includes('stream line 52') === true);
    await wait(340);
    expect(output.scrollTop).toBe(0);
    expect(Math.abs(details.getBoundingClientRect().height - narrowCappedHeight)).toBeLessThanOrEqual(2);
    expect(output.scrollWidth).toBeLessThanOrEqual(output.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);
  });
});
