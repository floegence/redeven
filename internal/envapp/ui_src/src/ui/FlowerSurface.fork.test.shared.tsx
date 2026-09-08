import { describe, expect, it, vi } from 'vitest';
import {
  adapter, deferred, flowerSurfaceNotifications, liveBootstrap,
  launchReceipt, renderSurfaceWithAdapter, thread, waitFor,
} from './FlowerSurface.navigation.testHarness';
import type { FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

async function forkFrom(runtime: HTMLElement, threadID: string) {
  const card = runtime.querySelector(`[data-thread-id="${threadID}"]`)!;
  (card.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
  await waitFor(() => !!document.querySelector('[role="menu"]'));
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Fork')!;
  button.click();
}

describe('Flower fork results', () => {
  it('continues the selected branch and keeps its reply across refresh and reconnect', async () => {
    const source = thread({ thread_id: 'source', title: 'Original' });
    const forked = thread({ thread_id: 'destination', title: 'Original · Fork' });
    const completed = thread({ ...forked, messages: [
      ...forked.messages,
      { id: 'followup', turn_id: 'turn-followup', role: 'user', content: 'Continue here', status: 'complete', created_at_ms: 3 },
      { id: 'reply', turn_id: 'turn-followup', role: 'assistant', content: 'Branch reply completed.', status: 'complete', created_at_ms: 4 },
    ] });
    const publishReply = deferred<void>();
    let created = false;
    let sent = false;
    let connections = 0;
    const listThreads = vi.fn(async () => created ? [source, sent ? completed : forked] : [source]);
    const loadThread = vi.fn(async (id: string) => liveBootstrap(id === 'source' ? source : sent ? completed : forked, sent ? 3 : 0));
    const forkThread = vi.fn(async () => { created = true; return forked; });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => {
      sent = true;
      return launchReceipt(input.thread_id!, 'turn-followup', 'start', input.client_request_id);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads, loadThread, forkThread, launchTurn,
      connectLiveStream: async function* ({ signal }) {
        const connection = ++connections;
        yield { schema_version: 1, kind: 'ready' as const, summaries: await listThreads() };
        if (connection === 1) {
          await Promise.race([publishReply.promise, new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))]);
          if (signal.aborted) return;
        }
        if (sent) yield { schema_version: 1, kind: 'thread.batch' as const, thread_id: forked.thread_id, current: liveBootstrap(completed, 3).current };
        if (connection === 1) return;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="source"]'));
    await forkFrom(runtime, 'source');
    await waitFor(() => document.activeElement === runtime.querySelector('textarea'));
    const textarea = runtime.querySelector('textarea')!;
    textarea.value = 'Continue here';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn.mock.calls[0][0]).toMatchObject({ thread_id: 'destination' });
    publishReply.resolve();
    await waitFor(() => connections >= 2 && runtime.textContent!.includes('Branch reply completed.'));
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    (runtime.querySelector('[data-thread-id="source"] button') as HTMLButtonElement).click();
    await waitFor(() => !!runtime.querySelector('[data-thread-id="source"][data-flower-thread-active="true"]'));
    (runtime.querySelector('[data-thread-id="destination"] button') as HTMLButtonElement).click();
    await waitFor(() => !!runtime.querySelector('[data-thread-id="destination"][data-flower-thread-active="true"]') && runtime.textContent!.includes('Branch reply completed.'));
    expect(runtime.querySelector('.flower-error-card')).toBeNull();
    expect(forkThread).toHaveBeenCalledTimes(1);
    expect(launchTurn).toHaveBeenCalledTimes(1);
  });

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
