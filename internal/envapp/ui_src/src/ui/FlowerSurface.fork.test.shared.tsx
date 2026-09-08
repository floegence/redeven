import { describe, expect, it, vi } from 'vitest';
import {
  adapter, deferred, flowerSurfaceNotifications, liveBootstrap,
  renderSurfaceWithAdapter, thread, waitFor,
} from './FlowerSurface.navigation.testHarness';

async function forkFrom(runtime: HTMLElement, threadID: string) {
  const card = runtime.querySelector(`[data-thread-id="${threadID}"]`)!;
  (card.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
  await waitFor(() => !!document.querySelector('[role="menu"]'));
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Fork')!;
  button.click();
}

describe('Flower fork results', () => {
  it('shows and selects the created branch before loading detail, then retries only detail', async () => {
    const source = thread({ thread_id: 'source', title: 'Original' });
    const forked = thread({ thread_id: 'destination', title: 'Original · Fork', messages: [] });
    const pending = deferred<typeof forked>();
    const forkThread = vi.fn(() => pending.promise);
    const loadThread = vi.fn().mockRejectedValueOnce(new Error('detail unavailable')).mockResolvedValue(liveBootstrap(forked));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [source]), forkThread, loadThread });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="source"]'));
    await forkFrom(runtime, 'source');
    await waitFor(() => runtime.textContent!.includes('Creating branch…'));
    (runtime.querySelector('[data-thread-id="source"] .flower-thread-card-menu-button') as HTMLButtonElement).click();
    await waitFor(() => !!document.querySelector('[role="menuitem"][aria-busy="true"]'));
    const busyAction = document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-busy="true"]')!;
    expect(busyAction.disabled).toBe(true);
    busyAction.click();
    expect(forkThread).toHaveBeenCalledTimes(1);
    busyAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pending.resolve(forked);
    await waitFor(() => !!runtime.querySelector('[data-thread-id="destination"][data-flower-thread-active="true"]'));
    await waitFor(() => runtime.textContent!.includes('Branch created, but could not load the conversation.'));
    expect(flowerSurfaceNotifications()).toContainEqual({ tone: 'success', message: 'Branch created.' });
    expect(forkThread).toHaveBeenCalledWith('source', expect.objectContaining({ title: 'Original · Fork' }));
    const retry = runtime.querySelector('.flower-thread-load-error button') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.click();
    await waitFor(() => loadThread.mock.calls.length === 2);
    await waitFor(() => !runtime.querySelector('.flower-thread-load-error'));
    expect(forkThread).toHaveBeenCalledTimes(1);
    expect(loadThread.mock.calls.every(([id]) => id === 'destination')).toBe(true);
  });

  it('reuses the exact request and title after a lost response', async () => {
    const source = thread({ thread_id: 'source', title: 'Original' });
    const forked = thread({ thread_id: 'destination', title: 'Original · Fork' });
    const forkThread = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(forked);
    const loadThread = vi.fn(async () => liveBootstrap(forked));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [source]), forkThread, loadThread });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="source"]'));
    await forkFrom(runtime, 'source');
    await waitFor(() => flowerSurfaceNotifications().some((item) => item.message === 'response lost'));
    await forkFrom(runtime, 'source');
    await waitFor(() => loadThread.mock.calls.length === 1);
    expect(forkThread.mock.calls[1]).toEqual(forkThread.mock.calls[0]);
    expect(forkThread.mock.calls[0][1].client_request_id).toBeTruthy();
    await waitFor(() => document.activeElement === runtime.querySelector('textarea'));
  });

  it('lists every persisted untitled fork without fabricating a canonical title', async () => {
    const forks = ['12345678', 'abcdefgh', '87654321', 'hgfedcba'].map((id) => thread({ thread_id: `thread-${id}`, title: '', title_status: 'unset', messages: [] }));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => forks) });
    await waitFor(() => runtime.querySelectorAll('[data-flower-thread-card]').length === 4);
    for (const fork of forks) {
      expect(runtime.querySelector(`[data-thread-id="${fork.thread_id}"]`)?.textContent).toContain(fork.thread_id.slice(-8));
      expect(fork.title).toBe('');
    }
  });
});
