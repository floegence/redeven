// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import {
  adapter,
  deferred,
  flush,
  flowerSurfaceNotifications,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

async function openThreadDeleteDialog(runtime: HTMLElement, threadID: string): Promise<HTMLButtonElement> {
  await flush();
  const card = runtime.querySelector(`[data-thread-id="${threadID}"]`) as HTMLElement | null;
  if (!card) throw new Error(`Missing card for ${threadID}.`);
  card.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100,
  }));
  await waitFor(() => Boolean(document.querySelector('[role="menuitem"][data-destructive="true"]')));
  (document.querySelector('[role="menuitem"][data-destructive="true"]') as HTMLButtonElement).click();
  await waitFor(() => document.body.textContent?.includes(DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteDialogTitle) === true);
  const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
    button.textContent?.trim() === DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteConfirm
  ));
  if (!confirm) throw new Error('Missing thread delete confirmation button.');
  return confirm;
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text);
}

describe('FlowerSurface thread deletion', () => {
  it('cancels without a request and submits a selected deletion only once', async () => {
    const selected = thread({ thread_id: 'thread-delete-selected', title: 'Selected deletion' });
    const receipt = deferred<{ status: 'committed' }>();
    const deleteThread = vi.fn(() => receipt.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      deleteThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-delete-selected"]')));
    (runtime.querySelector('[data-thread-id="thread-delete-selected"] .flower-thread-card-select-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-delete-selected');
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-loading') === 'false');

    await openThreadDeleteDialog(runtime, selected.thread_id);
    expect(document.body.textContent).toContain(selected.title);
    expect(document.body.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteDialogActiveDescription);
    expect(document.body.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteDialogWorkspaceDescription);
    buttonWithText(DEFAULT_FLOWER_SURFACE_COPY.threadList.cancel)?.click();
    await flush();
    expect(deleteThread).not.toHaveBeenCalled();

    const confirm = await openThreadDeleteDialog(runtime, selected.thread_id);
    confirm.click();
    confirm.click();
    expect(deleteThread).toHaveBeenCalledTimes(1);
    expect(deleteThread).toHaveBeenCalledWith(selected.thread_id);
    expect(document.body.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteDialogTitle);

    receipt.resolve({ status: 'committed' });
    await waitFor(() => !runtime.querySelector(`[data-thread-id="${selected.thread_id}"]`));
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'success',
      message: DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteCommittedNotification,
    }));
  });

  it('retires a pending background deletion without changing the selected draft', async () => {
    const current = thread({ thread_id: 'thread-delete-current', title: 'Current draft' });
    const background = thread({ thread_id: 'thread-delete-background', title: 'Background deletion', status: 'running' });
    const currentDetail = deferred<FlowerLiveBootstrap>();
    const backgroundLiveEvents = deferred<FlowerLiveEventsResponse>();
    const backgroundRefresh = deferred<readonly FlowerThreadSnapshot[]>();
    let listCall = 0;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(() => {
        listCall += 1;
        return listCall === 1 ? Promise.resolve([current, background]) : backgroundRefresh.promise;
      }),
      loadThread: vi.fn((threadID: string) => (
        threadID === current.thread_id ? currentDetail.promise : Promise.resolve(liveBootstrap(background))
      )),
      listThreadLiveEvents: vi.fn(() => backgroundLiveEvents.promise),
      deleteThread: vi.fn(async () => ({ status: 'pending' as const })),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${current.thread_id}"]`)));
    (runtime.querySelector(`[data-thread-id="${current.thread_id}"] .flower-thread-card-select-button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === current.thread_id);
    const composer = runtime.querySelector('textarea') as HTMLTextAreaElement;
    composer.value = 'Keep this draft';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    const confirm = await openThreadDeleteDialog(runtime, background.thread_id);
    expect(document.querySelector('.flower-thread-delete-active-warning[data-active="true"]')).toBeTruthy();
    confirm.click();
    await waitFor(() => !runtime.querySelector(`[data-thread-id="${background.thread_id}"]`));
    currentDetail.resolve(liveBootstrap(current));
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-loading') === 'false');

    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe(current.thread_id);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'info',
      message: DEFAULT_FLOWER_SURFACE_COPY.threadList.deletePendingNotification,
    }));
  });

  it('retires a terminal failed deletion and reports incomplete cleanup', async () => {
    const target = thread({ thread_id: 'thread-delete-failed', title: 'Failed deletion' });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [target]),
      deleteThread: vi.fn(async () => ({ status: 'failed' as const })),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)));
    (await openThreadDeleteDialog(runtime, target.thread_id)).click();
    await waitFor(() => !runtime.querySelector(`[data-thread-id="${target.thread_id}"]`));

    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      message: DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteFailedNotification,
    }));
  });

  it('keeps the dialog, selected thread, and draft after a pre-intent failure', async () => {
    const target = thread({ thread_id: 'thread-delete-rejected', title: 'Rejected deletion' });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [target]),
      loadThread: vi.fn(async () => liveBootstrap(target)),
      deleteThread: vi.fn(async () => { throw new Error('Delete request was not recorded.'); }),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)));
    (runtime.querySelector(`[data-thread-id="${target.thread_id}"] .flower-thread-card-select-button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === target.thread_id);
    const composer = runtime.querySelector('textarea') as HTMLTextAreaElement;
    composer.value = 'Preserve this draft';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    (await openThreadDeleteDialog(runtime, target.thread_id)).click();
    await waitFor(() => document.body.textContent?.includes('Delete request was not recorded.') === true);

    expect(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)).toBeTruthy();
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe(target.thread_id);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Preserve this draft');
    expect(document.body.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.deleteDialogTitle);
  });

  it('blocks stale list and detail responses even when the retirement refresh fails', async () => {
    const target = thread({ thread_id: 'thread-delete-stale', title: 'Stale response' });
    const staleRefresh = deferred<readonly FlowerThreadSnapshot[]>();
    const staleDetail = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn(() => staleDetail.promise);
    let listCall = 0;
    const listThreads = vi.fn(async () => {
      listCall += 1;
      if (listCall === 1) return [target];
      if (listCall === 2) return staleRefresh.promise;
      throw new Error('refresh unavailable');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      deleteThread: vi.fn(async () => ({ status: 'committed' as const })),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)));
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => listCall === 2);
    (runtime.querySelector(`[data-thread-id="${target.thread_id}"] .flower-thread-card-select-button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === target.thread_id);
    await waitFor(() => loadThread.mock.calls.length === 1);

    (await openThreadDeleteDialog(runtime, target.thread_id)).click();
    await waitFor(() => !runtime.querySelector(`[data-thread-id="${target.thread_id}"]`));
    staleRefresh.resolve([target]);
    staleDetail.resolve(liveBootstrap(target));
    await flush();
    await wait(20);

    expect(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)).toBeNull();
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('');
  });

  it('blocks a stale mutation response from re-inserting a retired thread', async () => {
    const target = thread({ thread_id: 'thread-delete-stale-mutation', title: 'Stale mutation' });
    const rename = deferred<FlowerLiveBootstrap>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [target]),
      renameThread: vi.fn(() => rename.promise),
      deleteThread: vi.fn(async () => ({ status: 'committed' as const })),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)));
    const card = runtime.querySelector(`[data-thread-id="${target.thread_id}"]`) as HTMLElement;
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
    await waitFor(() => Boolean(Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent?.trim() === 'Rename')));
    Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent?.trim() === 'Rename')?.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-rename-input')));
    const renameInput = runtime.querySelector('.flower-rename-input') as HTMLInputElement;
    renameInput.value = 'Old rename response';
    renameInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    buttonWithText(DEFAULT_FLOWER_SURFACE_COPY.threadList.save)?.click();

    (await openThreadDeleteDialog(runtime, target.thread_id)).click();
    await waitFor(() => !runtime.querySelector(`[data-thread-id="${target.thread_id}"]`));
    rename.resolve(liveBootstrap({ ...target, title: 'Old rename response' }));
    await flush();
    await wait(20);

    expect(runtime.querySelector(`[data-thread-id="${target.thread_id}"]`)).toBeNull();
  });
});
