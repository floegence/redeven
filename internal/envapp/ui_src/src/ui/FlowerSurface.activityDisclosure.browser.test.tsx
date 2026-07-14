import '../index.css';

import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import type { FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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

async function selectDisclosureThread(runtime: HTMLElement): Promise<HTMLButtonElement> {
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-browser-disclosure"] button')));
  (runtime.querySelector('[data-thread-id="thread-browser-disclosure"] button') as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'running');
  return runtime.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
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
    expect(getComputedStyle(desktopDetails).gridTemplateRows).not.toBe('0px');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

    await page.viewport(768, 900);
    const narrowDetails = runtime.querySelector('.flower-activity-inline-details') as HTMLElement;
    expect(narrowDetails.scrollWidth).toBeLessThanOrEqual(narrowDetails.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

    await complete();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await wait(850);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => button.getAttribute('aria-expanded') === 'false');
    expect(runtime.querySelector('.flower-activity-inline-details')?.getAttribute('data-state')).toBe('closing');
    await waitFor(() => runtime.querySelector('.flower-activity-inline-details') === null);
  });
});
