// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  deferred,
  flush,
  liveBootstrap,
  readStatus,
  renderSurfaceWithAdapter,
  thread,
  threadOrder,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface navigation threads', () => {
  it('keeps the left thread list ordered by creation time when a selected thread refreshes', async () => {
    const olderThread = thread({
      thread_id: 'thread-older',
      title: 'Older but active',
      created_at_ms: 1_000,
      updated_at_ms: 50_000,
    });
    const newerThread = thread({
      thread_id: 'thread-newer',
      title: 'Newer conversation',
      created_at_ms: 2_000,
      updated_at_ms: 3_000,
    });
    const loadThread = vi.fn(async () => liveBootstrap({
      ...olderThread,
      updated_at_ms: 90_000,
      messages: [
        ...olderThread.messages,
        {
          id: 'm-older-assistant',
          role: 'assistant' as const,
          content: 'Still in the older thread.',
          status: 'complete' as const,
          created_at_ms: 90_000,
        },
      ],
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [olderThread, newerThread]),
      loadThread,
    });

    await waitFor(() => threadOrder(runtime).length === 2);
    expect(threadOrder(runtime)).toEqual(['thread-newer', 'thread-older']);

    (runtime.querySelector('[data-thread-id="thread-older"] button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Still in the older thread.') ?? false);

    expect(threadOrder(runtime)).toEqual(['thread-newer', 'thread-older']);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-older');
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status')).toBe('idle');
    expect(runtime.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-status')).toBe('idle');
  });

  it('clears the unread sidebar dot immediately when a thread is selected', async () => {
    const unreadThread = thread({
      thread_id: 'thread-unread',
      title: 'Unread thread',
      read_status: readStatus(true, 3, 'success'),
    });
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...unreadThread,
      read_status: {
        is_unread: false,
        snapshot,
        read_state: {
          last_seen_activity_revision: snapshot.activity_revision,
          last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
          last_seen_activity_signature: snapshot.activity_signature,
        },
      },
    }));
    const loadThread = vi.fn(async () => liveBootstrap({
      ...unreadThread,
      read_status: readStatus(false, 3, 'success'),
      messages: [
        ...unreadThread.messages,
        {
          id: 'm-unread-assistant',
          role: 'assistant' as const,
          content: 'Fresh result.',
          status: 'complete' as const,
          created_at_ms: 3,
        },
      ],
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [unreadThread]),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread') === 'true');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] .flower-thread-status-dot')).toBeTruthy();

    (runtime.querySelector('[data-thread-id="thread-unread"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread') === 'false');
    await waitFor(() => markThreadRead.mock.calls.length > 0);

    expect(markThreadRead.mock.calls[0]?.[0]).toBe('thread-unread');
    expect(markThreadRead.mock.calls[0]?.[1]).toMatchObject(unreadThread.read_status.snapshot);
    expect(loadThread).toHaveBeenCalledWith('thread-unread');
    expect(runtime.textContent).toContain('Fresh result.');
  });

  it('keeps the running wave indicator stable across selected thread detail refreshes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-wave',
      title: 'Running wave',
      status: 'running',
      read_status: readStatus(true, 5_000, 'running'),
      updated_at_ms: 5_000,
      messages: [
        {
          id: 'm-running',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 5_000,
          blocks: [{ type: 'markdown', content: 'Working...' }],
        },
      ],
    });
    const firstDetail = {
      ...runningThread,
      read_status: readStatus(false, 5_000, 'running'),
    };
    let liveUpdateReady = false;
    const listThreads = vi.fn(async () => [runningThread]);
    const loadThread = vi.fn(async () => liveBootstrap(firstDetail, 1));
    const listThreadLiveEvents = vi.fn(async () => {
      if (!liveUpdateReady) return { events: [], next_cursor: 1, retained_from_seq: 1 };
      return {
        events: [{
          schema_version: 1,
          seq: 2,
          endpoint_id: 'test-runtime',
          thread_id: 'thread-running-wave',
          run_id: 'run-running-wave',
          at_unix_ms: 5_800,
          kind: 'message.block_delta' as const,
          payload: {
            message_id: 'm-running',
            block_index: 0,
            delta: ' still flowing',
          },
        }],
        next_cursor: 2,
        retained_from_seq: 1,
      };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-wave"] button')));
    const cardBeforeClick = runtime.querySelector('[data-thread-id="thread-running-wave"]') as HTMLElement;
    expect(cardBeforeClick.getAttribute('data-flower-thread-status')).toBe('running');
    expect(cardBeforeClick.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(cardBeforeClick.getAttribute('data-flower-thread-indicator')).toBe('wave');
    const waveBeforeClick = cardBeforeClick.querySelector('.flower-thread-wave');
    expect(waveBeforeClick).toBeTruthy();

    (cardBeforeClick.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    const waveAfterSelect = runtime.querySelector('[data-thread-id="thread-running-wave"] .flower-thread-wave');
    expect(waveAfterSelect).toBeTruthy();
    expect(waveAfterSelect).toBe(waveBeforeClick);
    expect(runtime.querySelector('[data-thread-id="thread-running-wave"]')?.getAttribute('data-flower-thread-unread')).toBe('false');

    liveUpdateReady = true;
    await waitFor(() => runtime.textContent?.includes('Working... still flowing') ?? false, 2500);
    expect(runtime.querySelector('[data-thread-id="thread-running-wave"] .flower-thread-wave')).toBe(waveAfterSelect);
    expect(runtime.textContent).toContain('Working... still flowing');
  });

  it('lets a new selected thread fetch live events even while the previous thread request is still pending', async () => {
    const firstThread = thread({
      thread_id: 'thread-live-first',
      title: 'First live',
      status: 'running',
      updated_at_ms: 5_000,
      messages: [{
        id: 'm-first',
        role: 'assistant',
        content: 'First',
        status: 'streaming',
        created_at_ms: 5_000,
      }],
    });
    const secondThread = thread({
      thread_id: 'thread-live-second',
      title: 'Second live',
      status: 'running',
      updated_at_ms: 5_100,
      messages: [{
        id: 'm-second',
        role: 'assistant',
        content: 'Second',
        status: 'streaming',
        created_at_ms: 5_100,
      }],
    });
    const firstLive = deferred<FlowerLiveEventsResponse>();
    const secondLive = deferred<FlowerLiveEventsResponse>();
    const listSummary = (value: FlowerThreadSnapshot): FlowerThreadSnapshot => ({
      ...value,
      messages: [],
      input_request: undefined,
      error: undefined,
    });
    const listThreads = vi.fn(async () => [listSummary(firstThread), listSummary(secondThread)]);
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-live-first' ? firstThread : secondThread, 1));
    const listThreadLiveEvents = vi.fn(async (threadID: string) => {
      if (threadID === 'thread-live-first') return firstLive.promise;
      if (threadID === 'thread-live-second') return secondLive.promise;
      throw new Error(`unexpected thread ${threadID}`);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-first"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-first"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-live-first'));

    (runtime.querySelector('[data-thread-id="thread-live-second"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-live-second'));

    expect(runtime.querySelector('[data-thread-id="thread-live-second"]')?.getAttribute('data-flower-thread-status')).toBe('running');

    firstLive.resolve({ events: [], next_cursor: 1, retained_from_seq: 1 });
    secondLive.resolve({ events: [], next_cursor: 1, retained_from_seq: 1 });
  });

  it('persists read state when a selected running thread receives unread detail refreshes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-read',
      title: 'Running read persistence',
      status: 'running',
      read_status: readStatus(false, 6_000, 'running'),
      updated_at_ms: 6_000,
      messages: [
        {
          id: 'm-running-read',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 6_000,
        },
      ],
    });
    const unreadDetail = {
      ...runningThread,
      read_status: readStatus(true, 6_500, 'running'),
      updated_at_ms: 6_500,
      messages: [
        {
          id: 'm-running-read',
          role: 'assistant' as const,
          content: 'Fresh selected update',
          status: 'streaming' as const,
          created_at_ms: 6_500,
        },
      ],
    };
    let detailHasFreshUnread = false;
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...(detailHasFreshUnread ? unreadDetail : runningThread),
      read_status: {
        is_unread: false,
        snapshot,
        read_state: {
          last_seen_activity_revision: snapshot.activity_revision,
          last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
          last_seen_activity_signature: snapshot.activity_signature,
        },
      },
    }));
    const loadThread = vi.fn(async () => liveBootstrap(detailHasFreshUnread ? unreadDetail : runningThread));
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-read"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-read"] button') as HTMLButtonElement).click();

    detailHasFreshUnread = true;
    listSnapshot = [unreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length >= 1, 2500);

    expect(runtime.querySelector('[data-thread-id="thread-running-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(runtime.textContent).toContain('Fresh selected update');
  });

  it('keeps the selected running wave node stable when a fresh unread snapshot arrives', async () => {
    const runningThread = thread({
      thread_id: 'thread-selected-live-snapshot',
      title: 'Selected live bootstrap',
      status: 'running',
      read_status: readStatus(false, 10_000, 'running'),
      updated_at_ms: 10_000,
      messages: [
        {
          id: 'm-live-a',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 10_000,
        },
      ],
    });
    const freshUnreadDetail = {
      ...runningThread,
      read_status: readStatus(true, 10_500, 'running'),
      updated_at_ms: 10_500,
      messages: [
        {
          id: 'm-live-a',
          role: 'assistant' as const,
          content: 'Working with fresh output',
          status: 'streaming' as const,
          created_at_ms: 10_500,
        },
      ],
    };
    let detailIsFresh = false;
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const loadThread = vi.fn(async () => liveBootstrap(detailIsFresh ? freshUnreadDetail : runningThread));
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...freshUnreadDetail,
      read_status: readStatus(false, snapshot.activity_revision, 'running'),
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"]')?.getAttribute('data-flower-thread-indicator') === 'wave');
    const waveBeforeFreshSnapshot = runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] .flower-thread-wave');

    detailIsFresh = true;
    listSnapshot = [freshUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => runtime.textContent?.includes('Working with fresh output') ?? false);
    await waitFor(() => markThreadRead.mock.calls.length > 0);
    expect(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] .flower-thread-wave')).toBe(waveBeforeFreshSnapshot);
    expect(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
  });

  it('queues a final read persistence when unread detail arrives before an in-flight mark-read completes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-final-read',
      title: 'Final read persistence',
      status: 'running',
      read_status: readStatus(true, 8_000, 'running'),
      updated_at_ms: 8_000,
      messages: [
        {
          id: 'm-running-final',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 8_000,
        },
      ],
    });
    const finalUnreadDetail = {
      ...runningThread,
      status: 'success' as const,
      read_status: readStatus(true, 8_500, 'success'),
      updated_at_ms: 8_500,
      messages: [
        {
          id: 'm-running-final',
          role: 'assistant' as const,
          content: 'Final selected update',
          status: 'complete' as const,
          created_at_ms: 8_500,
        },
      ],
    };
    const firstRead = deferred<FlowerLiveBootstrap>();
    const markThreadRead = vi.fn(async () => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return liveBootstrap({
        ...finalUnreadDetail,
        read_status: readStatus(false, 8_500, 'success'),
      });
    });
    let detailHasFinalUnread = false;
    const loadThread = vi.fn(async () => liveBootstrap(detailHasFinalUnread ? finalUnreadDetail : runningThread));
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-final-read"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-final-read"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length === 1);
    detailHasFinalUnread = true;
    listSnapshot = [finalUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Final selected update') ?? false, 2500);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status')).toBe('success');
    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-indicator')).toBe('none');
    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(markThreadRead).toHaveBeenCalledTimes(1);

    firstRead.resolve(liveBootstrap({
      ...runningThread,
      read_status: readStatus(false, 8_000, 'running'),
    }));
    await waitFor(() => markThreadRead.mock.calls.length >= 2);

    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
  });

  it('persists a queued final read even after the user leaves the thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-final-after-leave',
      title: 'Final read after leave',
      status: 'running',
      read_status: readStatus(true, 11_000, 'running'),
      updated_at_ms: 11_000,
      messages: [
        {
          id: 'm-running-leave',
          role: 'assistant',
          content: 'Working before leave',
          status: 'streaming',
          created_at_ms: 11_000,
        },
      ],
    });
    const finalUnreadDetail = {
      ...runningThread,
      status: 'success' as const,
      read_status: readStatus(true, 11_500, 'success'),
      updated_at_ms: 11_500,
      messages: [
        {
          id: 'm-running-leave',
          role: 'assistant' as const,
          content: 'Final before leaving',
          status: 'complete' as const,
          created_at_ms: 11_500,
        },
      ],
    };
    const firstRead = deferred<FlowerLiveBootstrap>();
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return liveBootstrap({
        ...finalUnreadDetail,
        read_status: readStatus(false, snapshot.activity_revision, 'success'),
      });
    });
    let detailHasFinalUnread = false;
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap(detailHasFinalUnread ? finalUnreadDetail : runningThread)),
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-final-after-leave"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-final-after-leave"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length === 1);

    detailHasFinalUnread = true;
    listSnapshot = [finalUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Final before leaving') ?? false);

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    firstRead.resolve(liveBootstrap({
      ...runningThread,
      read_status: readStatus(false, 11_000, 'running'),
    }));
    await waitFor(() => markThreadRead.mock.calls.length >= 2);

    expect(markThreadRead.mock.calls[1]?.[0]).toBe('thread-running-final-after-leave');
    expect(markThreadRead.mock.calls[1]?.[1]).toMatchObject(finalUnreadDetail.read_status.snapshot);
  });

  it('keeps a clicked thread visually read across stale list refreshes until a newer version arrives', async () => {
    const unreadThread = thread({
      thread_id: 'thread-refresh-race',
      title: 'Refresh race',
      updated_at_ms: 7_000,
      read_status: readStatus(true, 7_000, 'success'),
    });
    const newerUnreadThread = {
      ...unreadThread,
      updated_at_ms: 7_500,
      read_status: readStatus(true, 7_500, 'success'),
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [unreadThread];
    const markThreadRead = vi.fn(() => new Promise<FlowerLiveBootstrap>(() => undefined));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap({ ...unreadThread, read_status: readStatus(false, 7_000, 'success') })),
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'true');
    (runtime.querySelector('[data-thread-id="thread-refresh-race"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'false');

    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();
    expect(runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread')).toBe('false');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await flush();
    listSnapshot = [newerUnreadThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'true');
  });

  it('keeps target labels searchable without rendering them as sidebar badges', async () => {
    const runningThread = thread({
      thread_id: 'thread-stable-wave-labels',
      title: 'Stable wave labels',
      status: 'running',
      target_labels: ['Hidden target'],
    });
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stable-wave-labels"]')));
    expect(runtime.textContent).not.toContain('Hidden target');

    listSnapshot = [{
      ...runningThread,
      target_labels: ['Updated target'],
    }];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();

    expect(runtime.textContent).not.toContain('Updated target');
    const search = runtime.querySelector('.flower-thread-search-input') as HTMLInputElement;
    search.value = 'updated target';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stable-wave-labels"]')));
  });

  it('restores the unread dot when mark-read persistence fails', async () => {
    const unreadThread = thread({
      thread_id: 'thread-mark-read-error',
      title: 'Unread failure',
      read_status: readStatus(true, 9_000, 'success'),
    });
    const markThreadRead = vi.fn(async () => {
      throw new Error('read state unavailable');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [unreadThread]),
      loadThread: vi.fn(async () => liveBootstrap(unreadThread)),
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread') === 'true');
    (runtime.querySelector('[data-thread-id="thread-mark-read-error"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length > 0);

    expect(runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread')).toBe('true');
    expect(runtime.querySelector('.flower-thread-action-error')?.textContent).toContain('read state unavailable');
  });

  it('uses thread id as a stable tie breaker when conversations share a creation time', async () => {
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [
        thread({ thread_id: 'thread-c', title: 'C', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-a', title: 'A', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-b', title: 'B', created_at_ms: 4_000 }),
      ]),
    });

    await waitFor(() => threadOrder(runtime).length === 3);

    expect(threadOrder(runtime)).toEqual(['thread-a', 'thread-b', 'thread-c']);
  });

  it('opens thread actions from the keyboard and supports menu roving focus', async () => {
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread: vi.fn(async () => liveBootstrap(thread({ thread_id: 'thread-fork' }))),
      renameThread: vi.fn(async () => liveBootstrap(thread())),
      setThreadPinned: vi.fn(async () => liveBootstrap(thread({ pinned_at_ms: 10 }))),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"] button')));

    const rowButton = runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement;
    rowButton.focus();
    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await flush();

    const menu = runtime.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    const items = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toContain('Copy thread id');
    expect(document.activeElement).toBe(items[0]);

    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(items[items.length - 1]);
    items[items.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(runtime.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(rowButton);
  });

  it('disables fork for threads that are still running or waiting', async () => {
    const forkThread = vi.fn(async () => liveBootstrap(thread({ thread_id: 'thread-fork' })));
    const runningThread = thread({
      thread_id: 'thread-running',
      title: 'Running',
      status: 'running',
      messages: [],
    });
    const waitingThread = thread({
      thread_id: 'thread-waiting',
      title: 'Waiting',
      status: 'waiting_user',
      messages: [],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread, waitingThread]),
      forkThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running"]')));

    (runtime.querySelector('[data-thread-id="thread-running"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const runningFork = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Fork')) as HTMLButtonElement;
    expect(runningFork.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    (runtime.querySelector('[data-thread-id="thread-waiting"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const waitingFork = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Fork')) as HTMLButtonElement;
    expect(waitingFork.disabled).toBe(true);
    expect(forkThread).not.toHaveBeenCalled();
  });

  it('copies thread metadata with fallback clipboard feedback', async () => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [thread({ working_dir: '/workspace/redeven' })]),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Copy thread id')) as HTMLButtonElement).click();
    await flush();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(runtime.textContent).toContain('Copied thread id.');
    expect(document.activeElement).toBe(runtime.querySelector('[data-thread-id="thread-1"] button'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    execCommand.mockRestore();
  });

  it('shows rename failures inside the modal dialog', async () => {
    const renameThread = vi.fn(async () => {
      throw new Error('title too long');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      renameThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Rename')) as HTMLButtonElement).click();
    await flush();
    const dialog = runtime.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Rename conversation');
    const input = dialog.querySelector('input') as HTMLInputElement;
    input.value = 'A title that fails';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    (Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Save'))?.click();
    await flush();

    expect(renameThread).toHaveBeenCalled();
    expect(dialog.textContent).toContain('title too long');
    expect(runtime.querySelector('.flower-thread-action-error')).toBeNull();
  });

  it('disables all thread actions while a fork action is pending', async () => {
    const forkControl: { resolve?: (thread: FlowerLiveBootstrap) => void } = {};
    const forkThread = vi.fn(() => new Promise<FlowerLiveBootstrap>((resolve) => {
      forkControl.resolve = resolve;
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    const openForkMenu = async () => {
      (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      await flush();
      return Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Fork') || item.textContent?.includes('Working')) as HTMLButtonElement;
    };
    (await openForkMenu()).click();
    await flush();
    const pendingFork = await openForkMenu();

    expect(forkThread).toHaveBeenCalledTimes(1);
    expect(pendingFork.disabled).toBe(true);
    expect(pendingFork.textContent).toContain('Working');

    (runtime.querySelector('[data-thread-id="thread-2"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await flush();
    const secondThreadItems = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(secondThreadItems.length).toBeGreaterThan(0);
    expect(secondThreadItems.every((item) => item.disabled)).toBe(true);
    secondThreadItems.find((item) => item.textContent?.includes('Fork'))?.click();
    await flush();
    expect(forkThread).toHaveBeenCalledTimes(1);

    const completeFork = forkControl.resolve;
    if (!completeFork) throw new Error('fork promise did not start');
    completeFork(liveBootstrap(thread({ thread_id: 'thread-fork' })));
    await waitFor(() => forkThread.mock.calls.length === 1);
  });

  it('preserves loaded selected-thread details while a summary-only list refresh is waiting for detail reload', async () => {
    const detailedThread = thread({
      thread_id: 'thread-detail',
      title: 'Detailed thread',
      created_at_ms: 3_000,
      updated_at_ms: 3_100,
      status: 'running',
      error: {
        code: 'failed',
        message: 'Provider returned a structured failure.',
      },
      messages: [
        {
          id: 'm-detail',
          role: 'assistant',
          content: 'Loaded detail stays visible.',
          status: 'complete',
          created_at_ms: 3_100,
          blocks: [
            { type: 'markdown', content: 'Loaded detail stays visible.' },
            activityTimeline({
              status: 'running',
              severity: 'normal',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-read',
                tool_id: 'tool-read',
                tool_name: 'file.read',
                status: 'running',
                severity: 'normal',
                needs_attention: true,
                metadata: { target: 'AGENTS.md' },
              })],
            }),
          ],
        },
      ],
    });
    const summaryOnlyThread = {
      ...detailedThread,
      updated_at_ms: 3_500,
      messages: [],
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(liveBootstrap(detailedThread));
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerLiveBootstrap>(() => undefined);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-detail"] button')));
    (runtime.querySelector('[data-thread-id="thread-detail"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Loaded detail stays visible.') ?? false);

    listSnapshot = [summaryOnlyThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(runtime.textContent).toContain('Loaded detail stays visible.');
    expect(runtime.textContent).toContain('file.read');
    expect(runtime.querySelector('.flower-activity-inline')).toBeTruthy();
    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('Provider returned a structured failure.');
  });

  it('keeps background terminal refreshes when selected detail polling mutates the list', async () => {
    const selectedInitial = thread({
      thread_id: 'thread-selected-live',
      title: 'Selected live',
      created_at_ms: 4_000,
      updated_at_ms: 4_100,
      status: 'running',
      read_status: readStatus(false, 410, 'running'),
    });
    const selectedDetail = {
      ...selectedInitial,
      updated_at_ms: 4_200,
      read_status: readStatus(false, 420, 'running'),
      messages: [
        {
          id: 'm-selected-live',
          role: 'assistant' as const,
          content: 'Selected detail refreshed.',
          status: 'streaming' as const,
          created_at_ms: 4_200,
        },
      ],
    };
    const backgroundRunning = thread({
      thread_id: 'thread-background-live',
      title: 'Background live',
      created_at_ms: 3_000,
      updated_at_ms: 3_100,
      status: 'running',
      read_status: readStatus(false, 310, 'running'),
      messages: [],
    });
    const backgroundDone = {
      ...backgroundRunning,
      updated_at_ms: 3_200,
      status: 'success' as const,
      read_status: readStatus(true, 320, 'success'),
    };
    let listCalls = 0;
    const listThreads = vi.fn(() => {
      listCalls += 1;
      if (listCalls === 1) return Promise.resolve([selectedInitial, backgroundRunning]);
      return Promise.resolve([selectedDetail, backgroundDone]);
    });
    let loadCalls = 0;
    const loadThread = vi.fn(async (threadID: string) => {
      loadCalls += 1;
      const detail = threadID === 'thread-selected-live'
        ? { ...selectedDetail, updated_at_ms: selectedDetail.updated_at_ms + loadCalls }
        : backgroundRunning;
      return liveBootstrap(detail);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-live"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-live"] button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length >= 1);
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => listCalls >= 2);

    await wait(1250);
    await flush();
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-background-live"]')?.getAttribute('data-flower-thread-indicator') === 'dot');
    expect(runtime.querySelector('[data-thread-id="thread-background-live"]')?.getAttribute('data-flower-thread-unread')).toBe('true');
  });
});
