// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadPinMetadata, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { adapter, deferred, flush, flowerSurfaceNotifications, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
async function setup() {
  const stream = streamingFixture(1, 0);
  let summaries = ['first', 'second', 'third'].map((id, index) => thread({
    thread_id: id, title: id, pinned_at_ms: 30 - index, pin_rank: 3 - index, settings_revision: 1,
  }));
  const result = deferred<readonly FlowerThreadPinMetadata[]>();
  const listThreads = vi.fn(async () => summaries);
  const loadThread = vi.fn(async (id: string) => liveBootstrap(summaries.find((entry) => entry.thread_id === id)!));
  const base = adapter();
  const movePinnedThread = vi.fn(() => result.promise);
  const runtime = renderSurfaceWithAdapter({ ...base, listThreads, loadThread,
    connectLiveStream: stream.adapter.connectLiveStream, movePinnedThread,
    setThreadPinned: vi.fn(async () => ({ thread_id: 'third', pinned_at_ms: 0, pin_rank: 0, settings_revision: 2 })),
  });
  const row = (id: string) => runtime.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!;
  const order = () => Array.from(runtime.querySelectorAll<HTMLElement>('[data-flower-thread-card]')).map((node) => node.dataset.threadId);
  await waitFor(() => Boolean(row('third')));
  const moveDown = async () => {
    row('first').querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!.click();
    await flush();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent === copy.movePinnedDown)!.click();
    await flush();
  };
  const emit = async (next: FlowerThreadSnapshot[]) => {
    summaries = next;
    stream.emit({ schema_version: 1, kind: 'summary.batch', summaries });
    await waitFor(() => row(next[0].thread_id)?.textContent?.includes(next[0].title) === true);
    await flush();
  };
  return { runtime, row, order, moveDown, result, listThreads, loadThread, base, movePinnedThread, emit, stream, summaries: () => summaries };
}

const acknowledgement: FlowerThreadPinMetadata[] = [
  { thread_id: 'first', pinned_at_ms: 30, pin_rank: 2, settings_revision: 2 },
  { thread_id: 'second', pinned_at_ms: 29, pin_rank: 3, settings_revision: 2 },
];

describe('Flower pin operation convergence', () => {
  it('keeps the confirmed position after a failed refresh until the workspace stream converges', async () => {
    const ui = await setup();
    const first = ui.row('first');
    await ui.moveDown();
    expect(ui.order()).toEqual(['second', 'first', 'third']);
    expect(ui.row('first')).toBe(first);
    expect(ui.movePinnedThread).toHaveBeenCalledExactlyOnceWith('first', { anchor_thread_id: 'second', placement: 'after' });
    ui.listThreads.mockRejectedValueOnce(new Error('offline'));
    ui.result.resolve(acknowledgement);
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes(copy.pinRefreshFailed)));
    expect(ui.order()).toEqual(['second', 'first', 'third']);
    expect(ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.disabled).toBe(false);
    await ui.emit(ui.summaries().map((entry) => ({ ...entry, title: entry.title + ' canonical', title_generation: 2,
      pin_rank: entry.thread_id === 'third' ? 4 : entry.pin_rank, settings_revision: 3 })));
    expect(ui.order()).toEqual(['third', 'first', 'second']);
    expect(ui.loadThread).not.toHaveBeenCalled();
    expect(ui.base.markThreadRead).not.toHaveBeenCalled();
    expect(ui.stream.calls.connections).toBe(1);
  });

  it('does not let an older response or list read overwrite newer streamed settings', async () => {
    const ui = await setup();
    await ui.moveDown();
    const stale = ui.summaries();
    await ui.emit(stale.map((entry) => ({ ...entry, title: entry.title + ' newer', title_generation: 2,
      settings_revision: 3, pin_rank: entry.thread_id === 'third' ? 4 : entry.pin_rank })));
    ui.listThreads.mockResolvedValueOnce(stale);
    ui.result.resolve(acknowledgement);
    await waitFor(() => !ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.disabled);
    expect(ui.order()).toEqual(['third', 'first', 'second']);
    expect(ui.row('first').textContent).toContain('first newer');
    expect(ui.loadThread).not.toHaveBeenCalled();
    expect(ui.base.markThreadRead).not.toHaveBeenCalled();
  });

  it('rolls back only the failed move while preserving live updates and navigation', async () => {
    const ui = await setup();
    await ui.moveDown();
    ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!.click();
    await waitFor(() => ui.loadThread.mock.calls.length === 1);
    const input = ui.runtime.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.disabled).toBe(false);
    input.value = 'Keep this draft';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await ui.emit(ui.summaries().map((entry) => ({ ...entry, title: entry.title + ' live', title_generation: 2 })));
    ui.result.reject(new Error('anchor changed'));
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes(copy.pinUpdateFailed)));
    expect(ui.order()).toEqual(['first', 'second', 'third']);
    expect(ui.row('first').textContent).toContain('first live');
    expect(ui.row('third').querySelector('[aria-current="true"]')).not.toBeNull();
    expect(input.value).toBe('Keep this draft');
    expect(ui.stream.calls.connections).toBe(1);
  });
});
