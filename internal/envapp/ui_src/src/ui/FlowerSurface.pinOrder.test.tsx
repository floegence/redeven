// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { textWithoutHiddenCopies } from './textContent.test-support';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadPinMetadata, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { adapter, deferred, disposeRenderedSurface, flush, flowerSurfaceNotifications, liveBootstrap, renderSurfaceWithDraftCoordinator, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
async function setup(initialPins = ['first', 'second', 'third']) {
  const stream = streamingFixture(1, 0);
  let summaries = ['first', 'second', 'third'].map((id, index) => thread({
    thread_id: id, title: id, pinned_at_ms: initialPins.includes(id) ? 30 - index : 0,
    pin_rank: initialPins.includes(id) ? 3 - index : 0, settings_revision: 1,
  }));
  const result = deferred<readonly FlowerThreadPinMetadata[]>();
  const listThreads = vi.fn(async () => summaries);
  const loadThread = vi.fn(async (id: string) => liveBootstrap(summaries.find((entry) => entry.thread_id === id)!));
  const base = adapter();
  const movePinnedThread = vi.fn(() => result.promise);
  const setThreadPinned = vi.fn(async (): Promise<readonly FlowerThreadPinMetadata[]> => [{ thread_id: 'third', pinned_at_ms: 0, pin_rank: 0, settings_revision: 2 }]);
  const runtime = renderSurfaceWithDraftCoordinator({ ...base, listThreads, loadThread,
    connectLiveStream: stream.adapter.connectLiveStream, movePinnedThread,
    setThreadPinned,
  }, createFlowerComposerDraftCoordinator());
  const row = (id: string) => runtime.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!;
  const order = () => Array.from(runtime.querySelectorAll<HTMLElement>('[data-flower-thread-card]')).map((node) => node.dataset.threadId);
  await waitFor(() => Boolean(row('third')));
  const moveDown = async (id = 'first') => {
    row(id).querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!.click();
    await flush();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => textWithoutHiddenCopies(button) === copy.movePinnedDown)!.click();
    await flush();
  };
  const emit = async (next: FlowerThreadSnapshot[]) => {
    summaries = next;
    stream.emit({ schema_version: 1, kind: 'summary.batch', summaries });
    await waitFor(() => row(next[0].thread_id)?.textContent?.includes(next[0].title) === true);
    await flush();
  };
  return { runtime, row, order, moveDown, result, listThreads, loadThread, base, movePinnedThread, setThreadPinned, emit, stream, summaries: () => summaries };
}

const acknowledgement: FlowerThreadPinMetadata[] = [
  { thread_id: 'first', pinned_at_ms: 30, pin_rank: 2, settings_revision: 2 },
  { thread_id: 'second', pinned_at_ms: 29, pin_rank: 3, settings_revision: 2 },
];

describe('Flower pin operation convergence', () => {
  it('keeps an append at the tail when its summary arrives before shifted retained ranks', async () => {
    const ui = await setup(['third']);
    const pin = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.setThreadPinned.mockImplementationOnce(() => pin.promise);
    ui.row('first').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.click();
    expect(ui.order()).toEqual(['third', 'first', 'second']);
    await ui.emit(ui.summaries().map(entry => entry.thread_id === 'first'
      ? { ...entry, pinned_at_ms: 40, pin_rank: 1, settings_revision: 2 } : entry));
    expect(ui.order()).toEqual(['third', 'first', 'second']);
    pin.resolve([
      { thread_id: 'third', pinned_at_ms: 28, pin_rank: 2, settings_revision: 2 },
      { thread_id: 'first', pinned_at_ms: 40, pin_rank: 1, settings_revision: 2 },
    ]);
    await flush();
    expect(ui.order()).toEqual(['third', 'first', 'second']);
  });

  it('appends consecutive new pins in click order across delayed acknowledgements and stale reads', async () => {
    const ui = await setup(['first']);
    const third = ui.row('third');
    const title = third.querySelector('.flower-thread-list-title');
    const firstPin = deferred<readonly FlowerThreadPinMetadata[]>();
    const secondPin = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.setThreadPinned.mockImplementationOnce(() => firstPin.promise).mockImplementationOnce(() => secondPin.promise);
    const button = third.querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    button.focus(); button.click();
    ui.row('second').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.click();
    expect(ui.order()).toEqual(['first', 'third', 'second']);
    expect(document.activeElement).toBe(button);
    expect(button.disabled).toBe(false);
    firstPin.resolve([
      { thread_id: 'first', pinned_at_ms: 30, pin_rank: 2, settings_revision: 2 },
      { thread_id: 'third', pinned_at_ms: 40, pin_rank: 1, settings_revision: 2 },
    ]);
    await waitFor(() => ui.setThreadPinned.mock.calls.length === 2);
    expect(ui.order()).toEqual(['first', 'third', 'second']);
    secondPin.resolve([
      { thread_id: 'first', pinned_at_ms: 30, pin_rank: 3, settings_revision: 3 },
      { thread_id: 'third', pinned_at_ms: 40, pin_rank: 2, settings_revision: 3 },
      { thread_id: 'second', pinned_at_ms: 41, pin_rank: 1, settings_revision: 2 },
    ]);
    await waitFor(() => ui.listThreads.mock.calls.length === 2);
    await flush();
    expect(ui.order()).toEqual(['first', 'third', 'second']);
    expect(ui.row('third')).toBe(third);
    expect(third.querySelector('.flower-thread-list-title')).toBe(title);
    expect(document.activeElement).toBe(button);
    expect(ui.loadThread).not.toHaveBeenCalled();
  });

  it('stops queued writes and reconciliation when the surface is disposed', async () => {
    const ui = await setup();
    await ui.moveDown();
    ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.click();
    const reads = ui.listThreads.mock.calls.length;
    disposeRenderedSurface(ui.runtime);
    ui.result.resolve(acknowledgement);
    await flush();
    expect(ui.setThreadPinned).not.toHaveBeenCalled();
    expect(ui.listThreads).toHaveBeenCalledTimes(reads);
    expect(flowerSurfaceNotifications()).toEqual([]);
  });

  it('accepts pin changes immediately while another mutation is awaiting confirmation', async () => {
    const ui = await setup();
    await ui.moveDown();
    const button = ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(ui.row('third').dataset.pinned).toBe('false');
    expect(ui.setThreadPinned).not.toHaveBeenCalled();
    ui.result.resolve(acknowledgement);
    await waitFor(() => ui.setThreadPinned.mock.calls.length === 1);
    expect(ui.setThreadPinned).toHaveBeenCalledExactlyOnceWith('third', false);
    expect(ui.row('third').dataset.pinned).toBe('false');
  });

  it('does not hold controls or new writes behind the post-command list read', async () => {
    const ui = await setup();
    const refresh = deferred<FlowerThreadSnapshot[]>();
    await ui.moveDown();
    ui.listThreads.mockImplementationOnce(() => refresh.promise);
    ui.result.resolve(acknowledgement);
    await waitFor(() => ui.listThreads.mock.calls.length === 2);
    const button = ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    expect(button.disabled).toBe(false);
    button.click();
    await waitFor(() => ui.setThreadPinned.mock.calls.length === 1);
    expect(ui.row('third').dataset.pinned).toBe('false');
    refresh.resolve(ui.summaries());
    await flush();
    expect(ui.row('third').dataset.pinned).toBe('false');
  });

  it('coalesces unsent toggles while keeping the latest visible intent over acknowledgements', async () => {
    const ui = await setup();
    const first = deferred<readonly FlowerThreadPinMetadata[]>();
    const last = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.setThreadPinned.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => last.promise);
    const button = ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    button.click();
    expect(ui.row('third').dataset.pinned).toBe('false');
    button.click(); button.click(); button.click();
    expect(ui.row('third').dataset.pinned).toBe('true');
    expect(ui.order()).toEqual(['first', 'second', 'third']);
    expect(ui.setThreadPinned.mock.calls).toEqual([['third', false]]);
    first.resolve([{ thread_id: 'third', pinned_at_ms: 0, pin_rank: 0, settings_revision: 2 }]);
    await waitFor(() => ui.setThreadPinned.mock.calls.length === 2);
    expect(ui.setThreadPinned.mock.calls).toEqual([['third', false], ['third', true]]);
    expect(ui.row('third').dataset.pinned).toBe('true');
    expect(button.disabled).toBe(false);
    last.resolve([{ thread_id: 'third', pinned_at_ms: 40, pin_rank: 1, settings_revision: 3 }]);
    await flush();
    expect(ui.order()).toEqual(['first', 'second', 'third']);
  });

  it('replays consecutive relative moves without waiting for a list refresh', async () => {
    const ui = await setup();
    const second = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.movePinnedThread.mockImplementationOnce(() => ui.result.promise).mockImplementationOnce(() => second.promise);
    await ui.moveDown();
    await ui.moveDown();
    expect(ui.order()).toEqual(['second', 'third', 'first']);
    expect(ui.movePinnedThread).toHaveBeenCalledTimes(1);
    ui.result.resolve(acknowledgement);
    await waitFor(() => ui.movePinnedThread.mock.calls.length === 2);
    expect(ui.movePinnedThread).toHaveBeenLastCalledWith('first', { anchor_thread_id: 'third', placement: 'after' });
    expect(ui.order()).toEqual(['second', 'third', 'first']);
    second.resolve([
      { thread_id: 'first', pinned_at_ms: 30, pin_rank: 1, settings_revision: 3 },
      { thread_id: 'third', pinned_at_ms: 28, pin_rank: 2, settings_revision: 2 },
    ]);
    await flush();
    expect(ui.order()).toEqual(['second', 'third', 'first']);
  });

  it('rolls back a failed move without discarding a later pin or streamed title', async () => {
    const ui = await setup();
    const pin = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.setThreadPinned.mockImplementationOnce(() => pin.promise);
    await ui.moveDown();
    ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.click();
    await ui.emit(ui.summaries().map(entry => ({ ...entry, title: entry.title + ' live', title_generation: 2 })));
    ui.result.reject(new Error('anchor changed'));
    await waitFor(() => ui.setThreadPinned.mock.calls.length === 1);
    expect(ui.order()).toEqual(['first', 'second', 'third']);
    expect(ui.row('third').dataset.pinned).toBe('false');
    expect(ui.row('third').textContent).toContain('third live');
    expect(flowerSurfaceNotifications().some(notice => notice.message.includes(copy.pinUpdateFailed))).toBe(true);
    pin.resolve([{ thread_id: 'third', pinned_at_ms: 0, pin_rank: 0, settings_revision: 2 }]);
    await flush();
    expect(ui.row('third').dataset.pinned).toBe('false');
  });

  it('keeps pending intent visible across newer settings and rejects stale post-command reads', async () => {
    const ui = await setup();
    const refresh = deferred<FlowerThreadSnapshot[]>();
    const nextRead = deferred<FlowerThreadSnapshot[]>();
    await ui.moveDown();
    ui.listThreads.mockImplementationOnce(() => refresh.promise).mockImplementationOnce(() => nextRead.promise);
    ui.result.resolve(acknowledgement);
    await waitFor(() => ui.listThreads.mock.calls.length === 2);
    const pin = deferred<readonly FlowerThreadPinMetadata[]>();
    ui.setThreadPinned.mockImplementationOnce(() => pin.promise);
    ui.row('third').querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!.click();
    await ui.emit(ui.summaries().map(entry => ({ ...entry, title: entry.title + ' latest', title_generation: 2, settings_revision: 4 })));
    expect(ui.row('third').dataset.pinned).toBe('false');
    pin.resolve([{ thread_id: 'third', pinned_at_ms: 0, pin_rank: 0, settings_revision: 5 }]);
    await flush();
    refresh.resolve(ui.summaries().map(entry => ({ ...entry, settings_revision: 1 })));
    await waitFor(() => ui.listThreads.mock.calls.length === 3);
    expect(ui.row('third').dataset.pinned).toBe('false');
    expect(ui.row('third').textContent).toContain('third latest');
    await ui.emit(ui.summaries().map(entry => ({ ...entry, settings_revision: 6 })));
    expect(ui.row('third').dataset.pinned).toBe('true');
    nextRead.resolve(ui.summaries());
  });

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
