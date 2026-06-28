// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerLiveEvent,
  FlowerLiveEventsResponse,
  FlowerThreadActivitySnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  deferred,
  flush,
  inputRequest,
  liveBootstrap,
  modelIOStatus,
  readStatus,
  renderSurfaceWithAdapter,
  renderSurfaceWithFocusController,
  renderSurfaceWithAdapterProps,
  thread,
  threadOrder,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const askFlowerContextAction = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: 2,
  action_id: 'assistant.ask.flower',
  provider: 'flower',
  target: { target_id: 'local:local', locality: 'auto' },
  source: { surface: 'desktop_welcome_environment_card', surface_id: 'local' },
  execution_context: { runtime_hint: 'local_environment', session_source: 'local_runtime' },
  context: [{
    kind: 'text_snapshot',
    title: 'Local Environment',
    detail: 'Local · Ready',
    content: 'Environment: Local Environment\nKind: local_environment',
  }],
  presentation: { label: 'Ask Flower', priority: 100 },
  ...overrides,
});

const withoutContextActionKey = (
  action: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const next = { ...action };
  delete next[key];
  return next;
};

function liveEvent<K extends FlowerLiveEvent['kind']>(
  threadID: string,
  seq: number,
  kind: K,
  payload: FlowerLiveEvent<K>['payload'],
): FlowerLiveEvent<K> {
  return {
    schema_version: 1,
    seq,
    endpoint_id: 'test-runtime',
    thread_id: threadID,
    run_id: 'run-1',
    turn_id: 'turn-1',
    at_unix_ms: 10_000 + seq,
    kind,
    payload,
  } as FlowerLiveEvent<K>;
}

function markedReadStatus(snapshot: FlowerThreadActivitySnapshot, status = 'success'): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot,
    read_state: {
      last_seen_activity_revision: snapshot.activity_revision,
      last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
      last_seen_activity_signature: snapshot.activity_signature || `status:${status}\u001factivity:${snapshot.activity_revision}`,
      ...(snapshot.waiting_prompt_id ? { last_seen_waiting_prompt_id: snapshot.waiting_prompt_id } : {}),
    },
  };
}

function attachTranscriptScrollMetrics(transcript: HTMLElement, metrics: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): Readonly<{
  scrollTop: () => number;
  setScrollTop: (value: number) => void;
  setScrollHeight: (value: number) => void;
}> {
  let scrollTopValue = metrics.scrollTop;
  let scrollHeightValue = metrics.scrollHeight;
  Object.defineProperties(transcript, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: {
      configurable: true,
      get: () => scrollHeightValue,
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = Number(value);
      },
    },
  });
  return {
    scrollTop: () => scrollTopValue,
    setScrollTop: (value: number) => {
      scrollTopValue = value;
    },
    setScrollHeight: (value: number) => {
      scrollHeightValue = value;
    },
  };
}

describe('FlowerSurface navigation threads', () => {
  it('consumes external focus requests once without stealing later manual thread selection', async () => {
    const focusedThread = thread({
      thread_id: 'thread-focused',
      title: 'Focused handoff',
      created_at_ms: 2_000,
      updated_at_ms: 2_000,
    });
    const manualThread = thread({
      thread_id: 'thread-manual',
      title: 'Manual thread',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
      messages: [{
        id: 'manual-message',
        role: 'user',
        content: 'Manual selection',
        status: 'complete',
        created_at_ms: 1_000,
      }],
    });
    const listThreads = vi.fn(async () => [focusedThread, manualThread]);
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-focused' ? focusedThread : manualThread));
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads,
      loadThread,
    }, {
      focusThreadRequest: {
        request_id: 'focus-request-1',
        thread_id: 'thread-focused',
      },
    });

    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-focused');
    const initialRefreshCount = listThreads.mock.calls.length;
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => listThreads.mock.calls.length > initialRefreshCount);
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-manual"] button')));

    (runtime.querySelector('[data-thread-id="thread-manual"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-manual');

    const refreshCount = listThreads.mock.calls.length;
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => listThreads.mock.calls.length > refreshCount);
    await flush();

    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-manual');
    expect(loadThread.mock.calls.map((call) => call[0])).toContain('thread-focused');
    expect(loadThread.mock.calls.map((call) => call[0])).toContain('thread-manual');
  });

  it('does not replay a consumed focus request after the surface remounts', async () => {
    const focusedThread = thread({
      thread_id: 'thread-focused',
      title: 'Focused handoff',
      created_at_ms: 2_000,
      updated_at_ms: 2_000,
    });
    const manualThread = thread({
      thread_id: 'thread-manual',
      title: 'Manual thread',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
    });
    const listThreads = vi.fn(async () => [focusedThread, manualThread]);
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-focused' ? focusedThread : manualThread));
    const focusController = renderSurfaceWithFocusController({
      ...adapter(true),
      listThreads,
      loadThread,
    }, {
      request_id: 'focus-request-remount',
      thread_id: 'thread-focused',
    });

    await waitFor(() => focusController.runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-focused');
    await waitFor(() => focusController.consumedRequests().includes('focus-request-remount'));
    expect(focusController.focusThreadRequest()).toBeNull();

    focusController.runtime.remove();
    const remounted = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads,
      loadThread,
    }, {
      focusThreadRequest: focusController.focusThreadRequest(),
    });

    await waitFor(() => Boolean(remounted.querySelector('#redeven-flower-surface')));
    await flush();

    expect(remounted.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('');
    expect(loadThread.mock.calls.map((call) => call[0])).toEqual(['thread-focused']);
  });

  it('does not replay a slow consumed focus request when the surface remounts before loading finishes', async () => {
    const focusedThread = thread({
      thread_id: 'thread-pending-focus',
      title: 'Pending focused handoff',
      created_at_ms: 2_000,
      updated_at_ms: 2_000,
    });
    const slowFocusLoad = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn((threadID: string) => {
      if (threadID === 'thread-pending-focus') return slowFocusLoad.promise;
      return Promise.resolve(liveBootstrap(focusedThread));
    });
    const focusController = renderSurfaceWithFocusController({
      ...adapter(true),
      listThreads: vi.fn(async () => [focusedThread]),
      loadThread,
    }, {
      request_id: 'focus-request-pending-remount',
      thread_id: 'thread-pending-focus',
    });

    await waitFor(() => focusController.consumedRequests().includes('focus-request-pending-remount'));
    expect(focusController.focusThreadRequest()).toBeNull();
    expect(loadThread.mock.calls.map((call) => call[0])).toEqual(['thread-pending-focus']);

    focusController.runtime.remove();
    const remounted = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [focusedThread]),
      loadThread,
    }, {
      focusThreadRequest: focusController.focusThreadRequest(),
    });

    await waitFor(() => Boolean(remounted.querySelector('#redeven-flower-surface')));
    await flush();
    expect(loadThread.mock.calls.map((call) => call[0])).toEqual(['thread-pending-focus']);

    slowFocusLoad.resolve(liveBootstrap(focusedThread));
    await flush();
    expect(loadThread.mock.calls.map((call) => call[0])).toEqual(['thread-pending-focus']);
  });

  it('keeps composer drafts scoped to each thread and new chat session while refocusing the composer after selection', async () => {
    const threadA = thread({
      thread_id: 'thread-draft-a',
      title: 'Draft A',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
    });
    const threadB = thread({
      thread_id: 'thread-draft-b',
      title: 'Draft B',
      created_at_ms: 2_000,
      updated_at_ms: 2_000,
    });
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-draft-a' ? threadA : threadB));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-draft-a"] button')));

    (runtime.querySelector('[data-thread-id="thread-draft-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-draft-a');
    const composerA = runtime.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => document.activeElement === composerA);

    composerA.value = 'draft for A';
    composerA.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft for A');

    (runtime.querySelector('[data-thread-id="thread-draft-b"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-draft-b');
    const composerB = runtime.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => document.activeElement === composerB);
    expect(composerB.value).toBe('');

    composerB.value = 'draft for B';
    composerB.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();

    (runtime.querySelector('.flower-new-chat-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === '');
    const newComposer = runtime.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => document.activeElement === newComposer);
    expect(newComposer.value).toBe('');

    newComposer.value = 'draft for new chat';
    newComposer.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();

    (runtime.querySelector('[data-thread-id="thread-draft-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-draft-a');
    await waitFor(() => document.activeElement === runtime.querySelector('textarea'));
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft for A');

    (runtime.querySelector('[data-thread-id="thread-draft-b"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-draft-b');
    await waitFor(() => document.activeElement === runtime.querySelector('textarea'));
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft for B');

    (runtime.querySelector('.flower-new-chat-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === '');
    await waitFor(() => document.activeElement === runtime.querySelector('textarea'));
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft for new chat');

    expect(loadThread.mock.calls.map((call) => call[0])).toEqual(['thread-draft-a', 'thread-draft-b', 'thread-draft-a', 'thread-draft-b']);
  });

  it('does not let a slow focus request override a later manual selection', async () => {
    const slowFocusedThread = thread({
      thread_id: 'thread-slow-focus',
      title: 'Slow focused handoff',
      created_at_ms: 2_000,
      updated_at_ms: 2_000,
    });
    const manualThread = thread({
      thread_id: 'thread-manual',
      title: 'Manual thread',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
    });
    const slowFocusLoad = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn((threadID: string) => {
      if (threadID === 'thread-slow-focus') return slowFocusLoad.promise;
      return Promise.resolve(liveBootstrap(manualThread));
    });
    const focusController = renderSurfaceWithFocusController({
      ...adapter(true),
      listThreads: vi.fn(async () => [slowFocusedThread, manualThread]),
      loadThread,
    }, {
      request_id: 'focus-request-slow',
      thread_id: 'thread-slow-focus',
    });

    await waitFor(() => Boolean(focusController.runtime.querySelector('[data-thread-id="thread-manual"] button')));
    (focusController.runtime.querySelector('[data-thread-id="thread-manual"] button') as HTMLButtonElement).click();
    await waitFor(() => focusController.runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-manual');

    slowFocusLoad.resolve(liveBootstrap(slowFocusedThread));
    await flush();

    expect(focusController.runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-manual');
    expect(focusController.consumedRequests()).toContain('focus-request-slow');
    expect(focusController.focusThreadRequest()).toBeNull();
  });

  it('shows linked context metadata for context action user messages', async () => {
    const contextThread = thread({
      thread_id: 'thread-context',
      title: 'Environment context',
      messages: [{
        id: 'message-with-context',
        role: 'user',
        content: 'Inspect this environment',
        status: 'complete',
        created_at_ms: 1_000,
        blocks: [{ type: 'text', content: 'Inspect this environment' }],
        context_action: askFlowerContextAction(),
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [contextThread]),
      loadThread: vi.fn(async () => liveBootstrap(contextThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-chat-context-chip="true"]')));

    const chip = runtime.querySelector('[data-flower-chat-context-chip="true"]') as HTMLElement;
    expect(chip.textContent).toContain('Local Environment');
    expect(chip.textContent).toContain('Local · Ready');

    const container = runtime.querySelector('.flower-chat-context-chips') as HTMLElement;
    expect(container.getAttribute('data-flower-context-surface')).toBe('desktop_welcome_environment_card');
    expect(container.getAttribute('data-flower-context-target')).toBe('local:local');
  });

  it.each([
    ['non-Flower action id', askFlowerContextAction({ action_id: 'assistant.ask.other' })],
    ['non-Flower provider', askFlowerContextAction({ provider: 'other' })],
    ['missing target', withoutContextActionKey(askFlowerContextAction(), 'target')],
    ['invalid target locality', askFlowerContextAction({ target: { target_id: 'local:local', locality: 'legacy' } })],
    ['missing source', withoutContextActionKey(askFlowerContextAction(), 'source')],
    ['invalid source surface', askFlowerContextAction({ source: { surface: 'legacy_panel', surface_id: 'local' } })],
    ['invalid execution context shape', askFlowerContextAction({ execution_context: 'legacy' })],
    ['invalid runtime hint', askFlowerContextAction({ execution_context: { runtime_hint: 'legacy', session_source: 'local_runtime' } })],
    ['invalid runtime hint type', askFlowerContextAction({ execution_context: { runtime_hint: 1, session_source: 'local_runtime' } })],
    ['invalid session source', askFlowerContextAction({ execution_context: { runtime_hint: 'local_environment', session_source: 'legacy' } })],
    ['invalid context shape', askFlowerContextAction({ context: { kind: 'text_snapshot' } })],
    ['invalid context item shape', askFlowerContextAction({ context: ['legacy'] })],
    ['invalid context title type', askFlowerContextAction({ context: [{ kind: 'text_snapshot', title: 1 }] })],
  ])('does not show linked context metadata for malformed context action: %s', async (_caseName, contextAction) => {
    const contextThread = thread({
      thread_id: 'thread-context-malformed',
      title: 'Malformed environment context',
      messages: [{
        id: 'message-with-malformed-context',
        role: 'user',
        content: 'Inspect this environment',
        status: 'complete',
        created_at_ms: 1_000,
        blocks: [{ type: 'text', content: 'Inspect this environment' }],
        context_action: contextAction,
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [contextThread]),
      loadThread: vi.fn(async () => liveBootstrap(contextThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context-malformed"] button')));
    (runtime.querySelector('[data-thread-id="thread-context-malformed"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-context-malformed');
    await flush();

    expect(runtime.querySelector('[data-flower-chat-context-chip="true"]')).toBeNull();
  });

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
      status: 'success',
      read_status: readStatus(true, 3, 'success'),
    });
    const readResponse = deferred<FlowerThreadReadStatus>();
    const loadResponse = deferred<FlowerLiveBootstrap>();
    const markThreadRead = vi.fn((_threadID: string, _snapshot) => readResponse.promise);
    const loadedThread = {
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
    };
    const loadThread = vi.fn(() => loadResponse.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [unreadThread]),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread-dot') === 'true');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] .flower-thread-status-dot')).toBeTruthy();
    expect(runtime.querySelector('[data-thread-id="thread-unread"] button')?.getAttribute('aria-label')).toContain(', Unread');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] .flower-thread-indicator')?.getAttribute('title')).toContain('Unread');

    (runtime.querySelector('[data-thread-id="thread-unread"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread-dot') === 'false');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] button')?.getAttribute('aria-label')).not.toContain(', Unread');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] .flower-thread-indicator')?.getAttribute('title')).not.toContain('Unread');
    await waitFor(() => markThreadRead.mock.calls.length > 0);
    expect(loadThread).toHaveBeenCalledWith('thread-unread');

    expect(markThreadRead.mock.calls[0]?.[0]).toBe('thread-unread');
    expect(markThreadRead.mock.calls[0]?.[1]).toMatchObject(unreadThread.read_status.snapshot);

    loadResponse.resolve(liveBootstrap(loadedThread));
    readResponse.resolve(markedReadStatus(unreadThread.read_status.snapshot));
    await waitFor(() => runtime.textContent?.includes('Fresh result.') ?? false);
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
      if (!liveUpdateReady) return { stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 };
      return {
        stream_generation: 1,
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
    expect(cardBeforeClick.getAttribute('data-flower-thread-unread-dot')).toBe('false');
    expect(cardBeforeClick.getAttribute('data-flower-thread-indicator')).toBe('wave');
    const waveBeforeClick = cardBeforeClick.querySelector('.flower-thread-wave');
    expect(waveBeforeClick).toBeTruthy();

    (cardBeforeClick.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    const waveAfterSelect = runtime.querySelector('[data-thread-id="thread-running-wave"] .flower-thread-wave');
    expect(waveAfterSelect).toBeTruthy();
    expect(waveAfterSelect).toBe(waveBeforeClick);
    expect(runtime.querySelector('[data-thread-id="thread-running-wave"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');

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

    firstLive.resolve({ stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 });
    secondLive.resolve({ stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 });
  });

  it('lets a reselected thread fetch live events even while its old request is still pending', async () => {
    const firstThread = thread({
      thread_id: 'thread-live-reselect-first',
      title: 'First live reselect',
      status: 'running',
      updated_at_ms: 5_000,
      messages: [{
        id: 'm-reselect-first',
        role: 'assistant',
        content: 'First',
        status: 'streaming',
        created_at_ms: 5_000,
      }],
    });
    const secondThread = thread({
      thread_id: 'thread-live-reselect-second',
      title: 'Second live reselect',
      status: 'running',
      updated_at_ms: 5_100,
      messages: [{
        id: 'm-reselect-second',
        role: 'assistant',
        content: 'Second',
        status: 'streaming',
        created_at_ms: 5_100,
      }],
    });
    const firstOldLive = deferred<FlowerLiveEventsResponse>();
    const firstFreshLive = deferred<FlowerLiveEventsResponse>();
    const secondLive = deferred<FlowerLiveEventsResponse>();
    let firstPollCount = 0;
    const listThreadLiveEvents = vi.fn(async (threadID: string) => {
      if (threadID === 'thread-live-reselect-first') {
        firstPollCount += 1;
        return firstPollCount === 1 ? firstOldLive.promise : firstFreshLive.promise;
      }
      if (threadID === 'thread-live-reselect-second') return secondLive.promise;
      throw new Error(`unexpected thread ${threadID}`);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [firstThread, secondThread]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-live-reselect-first' ? firstThread : secondThread, 1)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-reselect-first"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-reselect-first"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.filter((call) => call[0] === 'thread-live-reselect-first').length === 1);

    (runtime.querySelector('[data-thread-id="thread-live-reselect-second"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-live-reselect-second'));

    (runtime.querySelector('[data-thread-id="thread-live-reselect-first"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.filter((call) => call[0] === 'thread-live-reselect-first').length === 2);

    firstFreshLive.resolve({ stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 });
    firstOldLive.resolve({
      stream_generation: 1,
      events: [liveEvent('thread-live-reselect-first', 2, 'thread.patched', {
        patch: { title: 'Stale first title', updated_at_ms: 5_200 },
      })],
      next_cursor: 2,
      retained_from_seq: 1,
    });
    secondLive.resolve({ stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 });
    await flush();

    expect(runtime.querySelector('[data-thread-id="thread-live-reselect-first"]')?.textContent).toContain('First live reselect');
    expect(runtime.querySelector('[data-thread-id="thread-live-reselect-first"]')?.textContent).not.toContain('Stale first title');
  });

  it('resets the selected live cursor when the stream generation advances', async () => {
    const selected = thread({
      thread_id: 'thread-live-generation-reset',
      title: 'Generation reset',
      status: 'running',
      messages: [{
        id: 'm-generation-reset',
        role: 'assistant',
        content: 'Old stream',
        status: 'streaming',
        created_at_ms: 1_000,
        blocks: [{ type: 'markdown', content: 'Old stream' }],
      }],
    });
    let pollCount = 0;
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => {
      pollCount += 1;
      if (pollCount === 1 && afterSeq === 0) {
        return {
          stream_generation: 1,
          events: [],
          next_cursor: 50,
          retained_from_seq: 1,
          has_more: true,
        } satisfies FlowerLiveEventsResponse;
      }
      if (pollCount === 2 && afterSeq === 50) {
        return {
          stream_generation: 2,
          events: [],
          next_cursor: 0,
          retained_from_seq: 1,
          has_more: true,
        } satisfies FlowerLiveEventsResponse;
      }
      if (pollCount === 3 && afterSeq === 0) {
        return {
          stream_generation: 2,
          events: [
            liveEvent('thread-live-generation-reset', 1, 'message.block_delta', {
              message_id: 'm-generation-reset',
              block_index: 0,
              delta: ' after restart',
            }),
          ],
          next_cursor: 1,
          retained_from_seq: 1,
          has_more: false,
        } satisfies FlowerLiveEventsResponse;
      }
      throw new Error(`unexpected after_seq ${afterSeq}`);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected, 0)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-generation-reset"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-generation-reset"] button') as HTMLButtonElement).click();

    await waitFor(() => runtime.textContent?.includes('Old stream after restart') === true);
    expect(listThreadLiveEvents.mock.calls.map((call) => call[1])).toEqual([0, 50, 0]);
  });

  it('continues polling live events while an idle selected thread has running context compaction', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compacting-live',
      title: 'Idle compacting live',
      status: 'idle',
      updated_at_ms: 5_200,
      context_compactions: [{
        operation_id: 'compact-idle-live',
        phase: 'start',
        status: 'compacting',
        trigger: 'slash_command',
        updated_at_ms: 5_200,
      }],
      timeline_decorations: [{
        decoration_id: 'decoration-idle-compact',
        kind: 'context_compaction',
        ordinal: 2,
        anchor: {
          target_kind: 'message',
          message_id: 'm1',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-idle-live',
          phase: 'start',
          status: 'compacting',
          trigger: 'slash_command',
          updated_at_ms: 5_200,
        },
      }],
    });
    const listThreadLiveEvents = vi.fn(async (_threadID: string, _afterSeq: number, _limit?: number) => ({
      stream_generation: 1,
      events: [],
      next_cursor: 1,
      retained_from_seq: 1,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread, 1)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compacting-live"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compacting-live"] button') as HTMLButtonElement).click();

    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-idle-compacting-live'));
    expect(runtime.querySelector('[data-flower-compaction-status="compacting"]')).toBeTruthy();
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
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => markedReadStatus(snapshot, 'running'));
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

    expect(runtime.querySelector('[data-thread-id="thread-running-read"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
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
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => markedReadStatus(snapshot, 'running'));
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
    expect(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
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
    const firstRead = deferred<FlowerThreadReadStatus>();
    const markThreadRead = vi.fn(async () => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return readStatus(false, 8_500, 'success');
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
    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
    expect(markThreadRead).toHaveBeenCalledTimes(1);

    firstRead.resolve(readStatus(false, 8_000, 'running'));
    await waitFor(() => markThreadRead.mock.calls.length >= 2);

    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
  });

  it('does not mark a newer unread snapshot read after the user leaves the thread', async () => {
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
    const firstRead = deferred<FlowerThreadReadStatus>();
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return markedReadStatus(snapshot, 'success');
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
    firstRead.resolve(readStatus(false, 11_000, 'running'));
    await flush();

    expect(markThreadRead).toHaveBeenCalledTimes(1);
  });

  it('marks a selected running thread read when live events complete it', async () => {
    const runningThread = thread({
      thread_id: 'thread-live-complete-read',
      title: 'Live complete read',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 12_000, 'running'),
      updated_at_ms: 12_000,
      messages: [
        {
          id: 'm-live-complete',
          role: 'assistant',
          content: 'Working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 12_000,
          blocks: [{ type: 'markdown', content: 'Working' }],
        },
      ],
    });
    const finalReadStatus = readStatus(true, 12_500, 'success');
    const finalThread = {
      ...runningThread,
      status: 'success' as const,
      model_io_status: null,
      read_status: readStatus(false, 12_500, 'success'),
      messages: [
        {
          id: 'm-live-complete',
          role: 'assistant' as const,
          content: 'Working done.',
          status: 'complete' as const,
          active_cursor: false,
          created_at_ms: 12_500,
          blocks: [{ type: 'markdown' as const, content: 'Working done.' }],
        },
      ],
    };
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => markedReadStatus(snapshot, 'success'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-complete-read"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-complete-read"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-live-complete-read', 1, 'message.committed', {
          message_id: 'm-live-complete',
          message: finalThread.messages[0],
        }),
        liveEvent('thread-live-complete-read', 2, 'thread.patched', {
          patch: {
            run_status: 'success',
            updated_at_ms: 12_500,
            read_status: finalReadStatus,
          },
        }),
      ],
      next_cursor: 2,
      retained_from_seq: 1,
    });

    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status') === 'success');
    await waitFor(() => markThreadRead.mock.calls.length === 1);
    expect(markThreadRead.mock.calls[0]?.[0]).toBe('thread-live-complete-read');
    expect(markThreadRead.mock.calls[0]?.[1]).toMatchObject(finalReadStatus.snapshot);
    expect(runtime.querySelector('[data-thread-id="thread-live-complete-read"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(0);
  });

  it('keeps a clicked thread visually read across stale list refreshes until a newer version arrives', async () => {
    const unreadThread = thread({
      thread_id: 'thread-refresh-race',
      title: 'Refresh race',
      status: 'success',
      updated_at_ms: 7_000,
      read_status: readStatus(true, 7_000, 'success'),
    });
    const newerUnreadThread = {
      ...unreadThread,
      updated_at_ms: 7_500,
      read_status: readStatus(true, 7_500, 'success'),
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [unreadThread];
    const markThreadRead = vi.fn(() => new Promise<FlowerThreadReadStatus>(() => undefined));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap({ ...unreadThread, read_status: readStatus(false, 7_000, 'success') })),
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread-dot') === 'true');
    (runtime.querySelector('[data-thread-id="thread-refresh-race"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread-dot') === 'false');

    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();
    expect(runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await flush();
    listSnapshot = [newerUnreadThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread-dot') === 'true');
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

  it('keeps a selected thread free of unread dots when mark-read persistence fails', async () => {
    const unreadThread = thread({
      thread_id: 'thread-mark-read-error',
      title: 'Unread failure',
      status: 'success',
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

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread-dot') === 'true');
    (runtime.querySelector('[data-thread-id="thread-mark-read-error"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length > 0);
    await flush();

    expect(runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('false');
    expect(runtime.querySelector('.flower-thread-action-error')?.textContent ?? '').not.toContain('read state unavailable');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-active') === 'false');
    expect(runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('true');
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

  it('ignores stale same-thread load responses that resolve after a newer load', async () => {
    const staleDetail = thread({
      thread_id: 'thread-stale-same-load',
      title: 'Stale same-thread load',
      messages: [{
        id: 'm-stale-same-load-old',
        role: 'assistant',
        content: 'Old selected detail.',
        status: 'complete',
        created_at_ms: 1_000,
        blocks: [{ type: 'markdown', content: 'Old selected detail.' }],
      }],
    });
    const freshDetail = thread({
      ...staleDetail,
      status: 'running',
      updated_at_ms: 5_000,
      messages: [{
        id: 'm-stale-same-load-new',
        role: 'assistant',
        content: 'Fresh selected detail.',
        status: 'streaming',
        created_at_ms: 5_000,
        blocks: [{ type: 'markdown', content: 'Fresh selected detail.' }],
      }],
      model_io_status: modelIOStatus({ run_id: 'run-stale-same-load' }),
    });
    const oldLoad = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn(() => (
      loadThread.mock.calls.length === 1
        ? oldLoad.promise
        : Promise.resolve(liveBootstrap(freshDetail))
    ));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [staleDetail]),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-same-load"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-same-load"] button') as HTMLButtonElement).click();
    (runtime.querySelector('[data-thread-id="thread-stale-same-load"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Fresh selected detail.') ?? false);

    oldLoad.resolve(liveBootstrap(staleDetail));
    await flush();

    expect(runtime.textContent).toContain('Fresh selected detail.');
    expect(runtime.textContent).not.toContain('Old selected detail.');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
  });

  it('keeps selected message rows mounted when a background thread list refresh changes', async () => {
    const selectedDetail = thread({
      thread_id: 'thread-selected-detail',
      title: 'Selected detail',
      created_at_ms: 5_000,
      updated_at_ms: 5_100,
      status: 'running',
      read_status: readStatus(false, 510, 'running'),
      messages: [
        {
          id: 'message-selected-stable',
          role: 'assistant',
          content: 'Selectable transcript text stays mounted.',
          status: 'complete',
          created_at_ms: 5_100,
          blocks: [{ type: 'markdown', content: 'Selectable transcript text stays mounted.' }],
        },
      ],
    });
    const selectedSummary = {
      ...selectedDetail,
      title: 'Selected summary after refresh',
      updated_at_ms: 5_300,
      read_status: readStatus(false, 530, 'running'),
      messages: [],
    };
    const backgroundInitial = thread({
      thread_id: 'thread-background-refresh',
      title: 'Background refresh',
      created_at_ms: 4_000,
      updated_at_ms: 4_100,
      status: 'running',
      read_status: readStatus(false, 410, 'running'),
      messages: [],
    });
    const backgroundUpdated = {
      ...backgroundInitial,
      updated_at_ms: 4_500,
      status: 'success' as const,
      read_status: readStatus(true, 450, 'success'),
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [selectedDetail, backgroundInitial];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(liveBootstrap(selectedDetail));
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerLiveBootstrap>(() => undefined);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-detail"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-detail"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Selectable transcript text stays mounted.') ?? false);
    const messageRow = runtime.querySelector('[data-flower-message-id="message-selected-stable"]');
    expect(messageRow).toBeTruthy();

    listSnapshot = [selectedSummary, backgroundUpdated];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    const messageRowAfterRefresh = runtime.querySelector('[data-flower-message-id="message-selected-stable"]');
    expect(messageRowAfterRefresh).toBe(messageRow);
    expect(runtime.textContent).toContain('Selectable transcript text stays mounted.');
    expect(runtime.querySelector('[data-thread-id="thread-background-refresh"]')?.getAttribute('data-flower-thread-indicator')).toBe('dot');
  });

  it('keeps selected message rows mounted when only a background thread changes', async () => {
    const selectedDetail = thread({
      thread_id: 'thread-selected-unchanged',
      title: 'Selected unchanged',
      created_at_ms: 5_500,
      updated_at_ms: 5_600,
      status: 'idle',
      read_status: readStatus(false, 560, 'idle'),
      messages: [
        {
          id: 'message-selected-unchanged',
          role: 'assistant',
          content: 'Selected thread has no business update.',
          status: 'complete',
          created_at_ms: 5_600,
          blocks: [{ type: 'markdown', content: 'Selected thread has no business update.' }],
        },
      ],
    });
    const selectedUnchangedSummary = {
      ...selectedDetail,
      messages: [],
    };
    const backgroundInitial = thread({
      thread_id: 'thread-background-only',
      title: 'Background only',
      created_at_ms: 5_000,
      updated_at_ms: 5_100,
      status: 'running',
      read_status: readStatus(false, 510, 'running'),
      messages: [],
    });
    const backgroundUpdated = {
      ...backgroundInitial,
      updated_at_ms: 5_900,
      status: 'success' as const,
      read_status: readStatus(true, 590, 'success'),
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [selectedDetail, backgroundInitial];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap(selectedDetail)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-unchanged"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-unchanged"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Selected thread has no business update.') ?? false);
    const messageRow = runtime.querySelector('[data-flower-message-id="message-selected-unchanged"]');
    expect(messageRow).toBeTruthy();

    listSnapshot = [selectedUnchangedSummary, backgroundUpdated];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-background-only"]')?.getAttribute('data-flower-thread-indicator') === 'dot');

    expect(runtime.querySelector('[data-flower-message-id="message-selected-unchanged"]')).toBe(messageRow);
    expect(runtime.textContent).toContain('Selected thread has no business update.');
  });

  it('hydrates a cursor-only streaming row in place when live text arrives', async () => {
    const streamingThread = thread({
      thread_id: 'thread-streaming-row',
      title: 'Streaming row',
      created_at_ms: 6_000,
      updated_at_ms: 6_100,
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 610, 'running'),
      messages: [
        {
          id: 'message-streaming-row',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 6_100,
        },
      ],
    });
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-streaming-row"] button')));
    (runtime.querySelector('[data-thread-id="thread-streaming-row"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const messageRow = runtime.querySelector('[data-flower-message-id="message-streaming-row"]');
    expect(messageRow).toBeTruthy();
    expect(messageRow?.textContent).not.toContain('Real streamed answer');

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-streaming-row', 1, 'message.block_started', {
          message_id: 'message-streaming-row',
          block_index: 0,
          block_type: 'markdown',
        }),
        liveEvent('thread-streaming-row', 2, 'message.block_delta', {
          message_id: 'message-streaming-row',
          block_index: 0,
          delta: 'Real streamed answer',
        }),
      ],
      next_cursor: 2,
      retained_from_seq: 1,
    });

    await waitFor(() => runtime.textContent?.includes('Real streamed answer') ?? false);
    expect(runtime.querySelector('[data-flower-message-id="message-streaming-row"]')).toBe(messageRow);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
  });

  it('keeps committed markdown DOM stable when streaming appends to the tail', async () => {
    const streamingThread = thread({
      thread_id: 'thread-streaming-markdown-stability',
      title: 'Streaming markdown stability',
      created_at_ms: 6_500,
      updated_at_ms: 6_600,
      status: 'running',
      read_status: readStatus(false, 660, 'running'),
      messages: [
        {
          id: 'message-streaming-markdown-stability',
          role: 'assistant',
          content: 'Committed paragraph.\n\nGrowing tail',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 6_600,
          blocks: [{ type: 'markdown', content: 'Committed paragraph.\n\nGrowing tail' }],
        },
      ],
    });
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-streaming-markdown-stability"] button')));
    (runtime.querySelector('[data-thread-id="thread-streaming-markdown-stability"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-chat-md-committed-segment')));
    const messageRow = runtime.querySelector('[data-flower-message-id="message-streaming-markdown-stability"]');
    const committedSegment = runtime.querySelector('.flower-chat-md-committed-segment');
    expect(messageRow).toBeTruthy();
    expect(committedSegment?.textContent).toContain('Committed paragraph.');

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-streaming-markdown-stability', 1, 'message.block_delta', {
          message_id: 'message-streaming-markdown-stability',
          block_index: 0,
          delta: ' plus more',
        }),
      ],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    await waitFor(() => runtime.textContent?.includes('Growing tail plus more') ?? false);
    expect(runtime.querySelector('[data-flower-message-id="message-streaming-markdown-stability"]')).toBe(messageRow);
    expect(runtime.querySelector('.flower-chat-md-committed-segment')).toBe(committedSegment);
  });

  it('keeps a text selection stable while the selected running thread streams updates', async () => {
    const streamingThread = thread({
      thread_id: 'thread-running-selection',
      title: 'Running selection',
      created_at_ms: 6_800,
      updated_at_ms: 6_900,
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 690, 'running'),
      messages: [
        {
          id: 'message-running-selection',
          role: 'assistant',
          content: 'Selectable running text.\n\nStreaming tail',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 6_900,
          blocks: [{ type: 'markdown', content: 'Selectable running text.\n\nStreaming tail' }],
        },
      ],
    });
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-selection"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-selection"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const messageRow = runtime.querySelector('[data-flower-message-id="message-running-selection"]');
    const committedSegment = runtime.querySelector('.flower-chat-md-committed-segment');
    const textNode = committedSegment?.firstChild?.firstChild;
    expect(messageRow).toBeTruthy();
    expect(textNode?.textContent).toContain('Selectable running text.');
    if (!textNode) throw new Error('Expected selectable committed text node.');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 'Selectable running text'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe('Selectable running text');

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-running-selection', 1, 'message.block_delta', {
          message_id: 'message-running-selection',
          block_index: 0,
          delta: ' updated',
        }),
      ],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    await waitFor(() => runtime.textContent?.includes('Streaming tail updated') ?? false);
    expect(runtime.querySelector('[data-flower-message-id="message-running-selection"]')).toBe(messageRow);
    expect(runtime.querySelector('.flower-chat-md-committed-segment')).toBe(committedSegment);
    expect(window.getSelection()?.toString()).toBe('Selectable running text');
  });

  it('keeps committed markdown selection stable when a streaming message commits', async () => {
    const streamingThread = thread({
      thread_id: 'thread-commit-selection',
      title: 'Commit selection',
      created_at_ms: 7_000,
      updated_at_ms: 7_100,
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 710, 'running'),
      messages: [
        {
          id: 'message-commit-selection',
          role: 'assistant',
          content: 'Committed paragraph.\n\nGrowing tail',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 7_100,
          blocks: [{ type: 'markdown', content: 'Committed paragraph.\n\nGrowing tail' }],
        },
      ],
    });
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-commit-selection"] button')));
    (runtime.querySelector('[data-thread-id="thread-commit-selection"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const messageRow = runtime.querySelector('[data-flower-message-id="message-commit-selection"]');
    const committedSegment = runtime.querySelector('.flower-chat-md-committed-segment');
    const textNode = committedSegment?.firstChild?.firstChild;
    expect(messageRow).toBeTruthy();
    expect(textNode?.textContent).toContain('Committed paragraph.');
    if (!textNode) throw new Error('Expected selectable committed text node.');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 'Committed paragraph'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe('Committed paragraph');

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-commit-selection', 1, 'message.committed', {
          message_id: 'message-commit-selection',
          message: {
            id: 'message-commit-selection',
            role: 'assistant',
            content: 'Committed paragraph.\n\nGrowing tail',
            status: 'complete',
            created_at_ms: 7_100,
            blocks: [{ type: 'markdown', content: 'Committed paragraph.\n\nGrowing tail' }],
          },
        }),
      ],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    expect(runtime.querySelector('[data-flower-message-id="message-commit-selection"]')).toBe(messageRow);
    expect(runtime.querySelector('.flower-chat-md-committed-segment')).toBe(committedSegment);
    expect(runtime.textContent).toContain('Growing tail');
    expect(window.getSelection()?.toString()).toBe('Committed paragraph');
  });

  it('updates running activity rows in place without disturbing selected transcript text', async () => {
    const runningActivity = activityTimeline({
      run_id: 'run-1',
      turn_id: 'turn-1',
      status: 'running',
      severity: 'normal',
      items: [activityItem({
        item_id: 'tool-search',
        tool_id: 'tool-search',
        tool_name: 'terminal.exec',
        status: 'running',
        severity: 'normal',
        needs_attention: false,
        metadata: { command: 'curl https://example.com' },
        started_at_unix_ms: 10_000,
      })],
    });
    const completedActivity = activityTimeline({
      run_id: 'run-1',
      turn_id: 'turn-1',
      status: 'success',
      severity: 'quiet',
      items: [activityItem({
        item_id: 'tool-search',
        tool_id: 'tool-search',
        tool_name: 'terminal.exec',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        metadata: { command: 'curl https://example.com', result_status: 'success' },
        started_at_unix_ms: 10_000,
        ended_at_unix_ms: 10_006,
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-running-activity',
      title: 'Running activity',
      created_at_ms: 7_200,
      updated_at_ms: 7_300,
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 730, 'running'),
      messages: [
        {
          id: 'message-running-activity',
          role: 'assistant',
          content: 'Stable selected activity text.\n\nWaiting on tool',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 7_300,
          blocks: [
            { type: 'markdown', content: 'Stable selected activity text.\n\nWaiting on tool' },
            runningActivity,
          ],
        },
      ],
    });
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-activity"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const messageRow = runtime.querySelector('[data-flower-message-id="message-running-activity"]');
    const activityRow = runtime.querySelector('[data-flower-activity-item-id="tool-search"]');
    const committedSegment = runtime.querySelector('.flower-chat-md-committed-segment');
    const textNode = committedSegment?.firstChild?.firstChild;
    expect(messageRow).toBeTruthy();
    expect(activityRow?.getAttribute('data-flower-activity-status')).toBe('running');
    expect(textNode?.textContent).toContain('Stable selected activity text.');
    if (!textNode) throw new Error('Expected selectable committed text node.');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 'Stable selected activity text'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe('Stable selected activity text');

    liveEvents.resolve({
      stream_generation: 1,
      events: [
        liveEvent('thread-running-activity', 1, 'activity.updated', {
          run_id: 'run-1',
          message_id: 'message-running-activity',
          block_index: 1,
          activity: completedActivity,
        }),
      ],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    await waitFor(() => runtime.querySelector('[data-flower-activity-item-id="tool-search"]')?.getAttribute('data-flower-activity-status') === 'success');
    expect(runtime.querySelector('[data-flower-message-id="message-running-activity"]')).toBe(messageRow);
    expect(runtime.querySelector('[data-flower-activity-item-id="tool-search"]')).toBe(activityRow);
    expect(runtime.querySelector('.flower-chat-md-committed-segment')).toBe(committedSegment);
    expect(runtime.querySelector('[data-flower-activity-item-id="tool-search"]')?.textContent).toContain('Done');
    expect(window.getSelection()?.toString()).toBe('Stable selected activity text');
  });

  it('reloads selected detail when the activity snapshot changes without a status timestamp change', async () => {
    const oldReadStatus = readStatus(false, 740, 'running');
    const freshReadStatus = readStatus(false, 741, 'running');
    const oldDetail = thread({
      thread_id: 'thread-activity-snapshot',
      title: 'Activity snapshot',
      created_at_ms: 7_400,
      updated_at_ms: 7_400,
      status: 'running',
      read_status: oldReadStatus,
      messages: [
        {
          id: 'message-activity-snapshot',
          role: 'assistant',
          content: 'Old selected detail.',
          status: 'streaming',
          created_at_ms: 7_400,
          blocks: [{ type: 'markdown', content: 'Old selected detail.' }],
        },
      ],
    });
    const freshSummary = {
      ...oldDetail,
      read_status: freshReadStatus,
      messages: [],
    };
    const freshDetail = {
      ...oldDetail,
      read_status: freshReadStatus,
      messages: [
        {
          id: 'message-activity-snapshot',
          role: 'assistant' as const,
          content: 'Fresh selected detail.',
          status: 'streaming' as const,
          created_at_ms: 7_400,
          blocks: [{ type: 'markdown' as const, content: 'Fresh selected detail.' }],
        },
      ],
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [oldDetail];
    const loadThread = vi.fn(async () => (loadThread.mock.calls.length === 1 ? liveBootstrap(oldDetail) : liveBootstrap(freshDetail)));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-activity-snapshot"] button')));
    (runtime.querySelector('[data-thread-id="thread-activity-snapshot"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Old selected detail.') ?? false);

    listSnapshot = [freshSummary];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => loadThread.mock.calls.length >= 2);
    await waitFor(() => runtime.textContent?.includes('Fresh selected detail.') ?? false);
    expect(runtime.textContent).not.toContain('Old selected detail.');
  });

  it('reloads selected detail when the waiting prompt id changes without a status timestamp change', async () => {
    const waitingReadStatus = (promptID: string) => {
      const status = readStatus(false, 710, 'waiting_user');
      return {
        ...status,
        snapshot: {
          ...status.snapshot,
          waiting_prompt_id: promptID,
        },
      };
    };
    const oldPrompt = inputRequest({
      prompt_id: 'prompt-old',
      public_summary: 'Old prompt summary',
    });
    const newPrompt = inputRequest({
      prompt_id: 'prompt-new',
      public_summary: 'New prompt summary',
    });
    const oldDetail = thread({
      thread_id: 'thread-waiting-prompt',
      title: 'Waiting prompt',
      created_at_ms: 7_000,
      updated_at_ms: 7_100,
      status: 'waiting_user',
      read_status: waitingReadStatus('prompt-old'),
      messages: [],
      input_request: oldPrompt,
    });
    const newSummary = {
      ...oldDetail,
      read_status: waitingReadStatus('prompt-new'),
      input_request: undefined,
    };
    const newDetail = {
      ...oldDetail,
      read_status: waitingReadStatus('prompt-new'),
      input_request: newPrompt,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [oldDetail];
    const loadThread = vi.fn(async () => (loadThread.mock.calls.length === 1 ? liveBootstrap(oldDetail) : liveBootstrap(newDetail)));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-prompt"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-prompt"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Old prompt summary') ?? false);

    listSnapshot = [newSummary];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => loadThread.mock.calls.length >= 2);
    await waitFor(() => runtime.textContent?.includes('New prompt summary') ?? false);
    expect(runtime.textContent).not.toContain('Old prompt summary');
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
    const markThreadRead = vi.fn(async () => backgroundDone.read_status);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      markThreadRead,
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
    expect(runtime.querySelector('[data-thread-id="thread-background-live"]')?.getAttribute('data-flower-thread-unread-dot')).toBe('true');
    expect(markThreadRead).not.toHaveBeenCalled();
  });

  it('renders one bottom model status indicator for a running thread with backend active cursor metadata', async () => {
    const runningThread = thread({
      thread_id: 'thread-single-model-status',
      title: 'Single model status',
      created_at_ms: 8_000,
      updated_at_ms: 8_100,
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      read_status: readStatus(false, 810, 'running'),
      messages: [
        {
          id: 'message-old-streaming',
          role: 'assistant',
          content: 'Old streaming-looking output.',
          status: 'streaming',
          created_at_ms: 8_000,
          blocks: [{ type: 'markdown', content: 'Old streaming-looking output.' }],
        },
        {
          id: 'message-active-streaming',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 8_100,
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-single-model-status"] button')));
    (runtime.querySelector('[data-thread-id="thread-single-model-status"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    expect(runtime.querySelector('[data-flower-message-id="message-old-streaming"] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-id="message-active-streaming"] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
    expect(runtime.querySelector('.flower-model-status-lane')?.textContent).toContain('Thinking...');
    expect(runtime.querySelector('.flower-model-status-text')?.textContent).toBe('Thinking...');
    expect(runtime.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Thinking');
  });

  it('shows a floating scroll control when the transcript is away from latest output', async () => {
    const selectedThread = thread({
      thread_id: 'thread-scroll-latest',
      title: 'Scroll latest',
      messages: [
        {
          id: 'm-scroll-user',
          role: 'user',
          content: 'Start a long report',
          status: 'complete',
          created_at_ms: 1,
        },
        {
          id: 'm-scroll-agent',
          role: 'assistant',
          content: 'Latest Agent output',
          status: 'complete',
          created_at_ms: 2,
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-scroll-latest"] button')));
    (runtime.querySelector('[data-thread-id="thread-scroll-latest"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-scroll-agent"]')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const scrollMetrics = attachTranscriptScrollMetrics(transcript, {
      clientHeight: 400,
      scrollHeight: 1400,
      scrollTop: 120,
    });
    await waitFor(() => scrollMetrics.scrollTop() === 1000);
    scrollMetrics.setScrollTop(120);
    transcript.dispatchEvent(new Event('scroll', { bubbles: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-scroll-to-latest-button')));
    const button = runtime.querySelector('.flower-scroll-to-latest-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Scroll to latest');
    expect(runtime.querySelector('.flower-scroll-to-latest-float .flower-scroll-to-latest-button')).toBe(button);
    expect(runtime.querySelector('.flower-chat-bottom-dock-track .flower-scroll-to-latest-button')).toBeNull();

    button.click();

    await waitFor(() => scrollMetrics.scrollTop() === 1000);
    await waitFor(() => !runtime.querySelector('.flower-scroll-to-latest-button'));
  });

  it('opens a newly selected long thread at the latest output', async () => {
    let transcriptScrollTop = 0;
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeightMock(this: HTMLElement) {
      return this.classList.contains('flower-chat-transcript') ? 180 : 0;
    });
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeightMock(this: HTMLElement) {
      return this.classList.contains('flower-chat-transcript') ? 920 : 0;
    });
    const scrollTopSpy = vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function scrollTopMock(this: HTMLElement) {
      return this.classList.contains('flower-chat-transcript') ? transcriptScrollTop : 0;
    });
    const scrollTopSetSpy = vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function scrollTopSetMock(this: HTMLElement, value: number) {
      if (this.classList.contains('flower-chat-transcript')) {
        transcriptScrollTop = Number(value);
      }
    });
    try {
      const selectedThread = thread({
        thread_id: 'thread-long-on-load',
        title: 'Long on load',
        messages: [
          {
            id: 'm-long-user',
            role: 'user',
            content: 'Start a long report',
            status: 'complete',
            created_at_ms: 1,
          },
          {
            id: 'm-long-agent',
            role: 'assistant',
            content: 'Latest Agent output',
            status: 'complete',
            created_at_ms: 2,
          },
        ],
      });
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [selectedThread]),
        loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
      });

      await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-long-on-load"] button')));
      (runtime.querySelector('[data-thread-id="thread-long-on-load"] button') as HTMLButtonElement).click();
      await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-long-agent"]')));

      await waitFor(() => transcriptScrollTop === 740);
      expect(runtime.querySelector('.flower-scroll-to-latest-button')).toBeNull();
    } finally {
      clientHeightSpy.mockRestore();
      scrollHeightSpy.mockRestore();
      scrollTopSpy.mockRestore();
      scrollTopSetSpy.mockRestore();
    }
  });

  it('keeps following latest output while the selected running thread streams', async () => {
    const runningThread = thread({
      thread_id: 'thread-follow-running',
      title: 'Follow running',
      status: 'running',
      messages: [{
        id: 'm-follow-running',
        role: 'assistant',
        content: 'Working',
        status: 'streaming',
        created_at_ms: 1,
        blocks: [{ type: 'markdown', content: 'Working' }],
      }],
    });
    let liveReady = false;
    const listThreadLiveEvents = vi.fn(async () => {
      if (!liveReady) {
        return { stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 };
      }
      return {
        stream_generation: 1,
        events: [liveEvent('thread-follow-running', 2, 'message.block_delta', {
          message_id: 'm-follow-running',
          block_index: 0,
          delta: ' with details',
        })],
        next_cursor: 2,
        retained_from_seq: 1,
      } satisfies FlowerLiveEventsResponse;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 1)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-follow-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-follow-running"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-follow-running"]')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const scrollMetrics = attachTranscriptScrollMetrics(transcript, {
      clientHeight: 180,
      scrollHeight: 920,
      scrollTop: 740,
    });
    liveReady = true;
    scrollMetrics.setScrollHeight(1100);

    await waitFor(() => runtime.textContent?.includes('Working with details') === true, 2500);
    await waitFor(() => scrollMetrics.scrollTop() === 920);
    expect(runtime.querySelector('.flower-scroll-to-latest-button')).toBeNull();
  });

  it('lets user scrolling interrupt running thread follow mode until returning to latest', async () => {
    const runningThread = thread({
      thread_id: 'thread-follow-interrupt',
      title: 'Follow interrupt',
      status: 'running',
      messages: [{
        id: 'm-follow-interrupt',
        role: 'assistant',
        content: 'Working',
        status: 'streaming',
        created_at_ms: 1,
        blocks: [{ type: 'markdown', content: 'Working' }],
      }],
    });
    let interruptedDeltaReady = false;
    let interruptedDeltaDelivered = false;
    let resumedDeltaReady = false;
    let resumedDeltaDelivered = false;
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => {
      if (afterSeq <= 1 && interruptedDeltaReady && !interruptedDeltaDelivered) {
        interruptedDeltaDelivered = true;
        return {
          stream_generation: 1,
          events: [liveEvent('thread-follow-interrupt', 2, 'message.block_delta', {
            message_id: 'm-follow-interrupt',
            block_index: 0,
            delta: ' after user scroll',
          })],
          next_cursor: 2,
          retained_from_seq: 1,
        } satisfies FlowerLiveEventsResponse;
      }
      if (afterSeq <= 2 && resumedDeltaReady && !resumedDeltaDelivered) {
        resumedDeltaDelivered = true;
        return {
          stream_generation: 1,
          events: [liveEvent('thread-follow-interrupt', 3, 'message.block_delta', {
            message_id: 'm-follow-interrupt',
            block_index: 0,
            delta: ' after returning',
          })],
          next_cursor: 3,
          retained_from_seq: 1,
        } satisfies FlowerLiveEventsResponse;
      }
      if (afterSeq <= 1) {
        return { stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 };
      }
      return {
        stream_generation: 1,
        events: [],
        next_cursor: afterSeq,
        retained_from_seq: 1,
      } satisfies FlowerLiveEventsResponse;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 1)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-follow-interrupt"] button')));
    (runtime.querySelector('[data-thread-id="thread-follow-interrupt"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-follow-interrupt"]')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const scrollMetrics = attachTranscriptScrollMetrics(transcript, {
      clientHeight: 180,
      scrollHeight: 920,
      scrollTop: 740,
    });
    transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
    scrollMetrics.setScrollTop(300);
    transcript.dispatchEvent(new Event('scroll', { bubbles: true }));
    interruptedDeltaReady = true;
    scrollMetrics.setScrollHeight(1100);

    await waitFor(() => runtime.textContent?.includes('Working after user scroll') === true, 2500);
    expect(scrollMetrics.scrollTop()).toBe(300);
    await waitFor(() => Boolean(runtime.querySelector('.flower-scroll-to-latest-button')));

    const button = runtime.querySelector('.flower-scroll-to-latest-button') as HTMLButtonElement;
    button.click();
    await waitFor(() => scrollMetrics.scrollTop() === 920);

    resumedDeltaReady = true;
    scrollMetrics.setScrollHeight(1280);
    await waitFor(() => runtime.textContent?.includes('Working after user scroll after returning') === true, 2500);
    await waitFor(() => scrollMetrics.scrollTop() === 1100);
  });

  it('follows timeline replacements while latest output is still selected', async () => {
    const runningThread = thread({
      thread_id: 'thread-follow-replaced',
      title: 'Follow replaced',
      status: 'running',
      messages: [{
        id: 'm-follow-replaced-old',
        role: 'assistant',
        content: 'Old output',
        status: 'streaming',
        created_at_ms: 1,
      }],
    });
    let liveReady = false;
    const listThreadLiveEvents = vi.fn(async () => {
      if (!liveReady) {
        return { stream_generation: 1, events: [], next_cursor: 1, retained_from_seq: 1 };
      }
      return {
        stream_generation: 1,
        events: [liveEvent('thread-follow-replaced', 2, 'timeline.replaced', {
          messages: [{
            id: 'm-follow-replaced-new',
            role: 'assistant',
            content: 'Canonical latest output',
            status: 'streaming',
            created_at_ms: 2,
          }],
          stream_generation: 1,
          snapshot_through_seq: 2,
        })],
        next_cursor: 2,
        retained_from_seq: 1,
      } satisfies FlowerLiveEventsResponse;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 1)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-follow-replaced"] button')));
    (runtime.querySelector('[data-thread-id="thread-follow-replaced"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-follow-replaced-old"]')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const scrollMetrics = attachTranscriptScrollMetrics(transcript, {
      clientHeight: 180,
      scrollHeight: 920,
      scrollTop: 740,
    });
    liveReady = true;
    scrollMetrics.setScrollHeight(1040);

    await waitFor(() => runtime.textContent?.includes('Canonical latest output') === true, 2500);
    await waitFor(() => scrollMetrics.scrollTop() === 860);
  });

  it('ignores stale selected-thread load scrolls after a faster thread switch', async () => {
    const firstThread = thread({
      thread_id: 'thread-stale-scroll-first',
      title: 'First stale scroll',
      messages: [{
        id: 'm-stale-first',
        role: 'assistant',
        content: 'First loaded late',
        status: 'complete',
        created_at_ms: 1,
      }],
    });
    const secondThread = thread({
      thread_id: 'thread-stale-scroll-second',
      title: 'Second current scroll',
      messages: [{
        id: 'm-stale-second',
        role: 'assistant',
        content: 'Second current',
        status: 'complete',
        created_at_ms: 2,
      }],
    });
    const firstLoad = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn(async (threadID: string) => {
      if (threadID === 'thread-stale-scroll-first') return firstLoad.promise;
      if (threadID === 'thread-stale-scroll-second') return liveBootstrap(secondThread);
      throw new Error(`unexpected thread ${threadID}`);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [firstThread, secondThread]),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-scroll-first"] button')));
    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const scrollMetrics = attachTranscriptScrollMetrics(transcript, {
      clientHeight: 180,
      scrollHeight: 920,
      scrollTop: 0,
    });

    (runtime.querySelector('[data-thread-id="thread-stale-scroll-first"] button') as HTMLButtonElement).click();
    (runtime.querySelector('[data-thread-id="thread-stale-scroll-second"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Second current') === true);
    await waitFor(() => scrollMetrics.scrollTop() === 740);

    scrollMetrics.setScrollTop(500);
    scrollMetrics.setScrollHeight(1600);
    firstLoad.resolve(liveBootstrap(firstThread));
    await flush();
    await wait(40);

    expect(runtime.textContent).toContain('Second current');
    expect(runtime.textContent).not.toContain('First loaded late');
    expect(scrollMetrics.scrollTop()).toBe(500);
  });
});
