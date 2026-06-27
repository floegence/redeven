// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerRouterDecision,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  decision,
  deferred,
  inputRequest,
  activityItem,
  activityTimeline,
  liveBootstrap,
  modelIOStatus,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function withLaunchUserMessageID<T extends { readonly messages: readonly { readonly id: string }[] }>(threadValue: T, currentUserID: string, nextUserID: string): T {
  return {
    ...threadValue,
    messages: threadValue.messages.map((message) => (
      message.id === currentUserID ? { ...message, id: nextUserID } : message
    )),
  } as T;
}

describe('FlowerSurface navigation launch/send', () => {
  it('stops a running selected thread from the composer when the draft is empty', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop',
      title: 'Running stop',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopThread = vi.fn(async () => liveBootstrap(stoppedThread));
    const launchTurn = vi.fn(async () => liveBootstrap(stoppedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    const stopIcon = stopButton.querySelector('svg');
    const stopIconRect = stopIcon?.querySelector('rect');
    expect(stopButton.className).toContain('flower-composer-submit');
    expect(stopButton.className).toContain('rounded-full');
    expect(stopIcon?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(stopIconRect?.getAttribute('x')).toBe('6');
    expect(stopIconRect?.getAttribute('y')).toBe('6');
    expect(stopIconRect?.getAttribute('width')).toBe('12');
    expect(stopIconRect?.getAttribute('height')).toBe('12');
    expect(stopIconRect?.getAttribute('stroke')).toBe('none');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length > 0);

    expect(stopThread).toHaveBeenCalledWith('thread-running-stop');
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('prevents duplicate stop clicks while thread stop is in flight', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-once',
      title: 'Running stop once',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopDeferred = deferred<FlowerLiveBootstrap>();
    const stopThread = vi.fn(() => stopDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-once"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-once"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    stopButton.click();
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length === 1);

    expect(stopThread).toHaveBeenCalledTimes(1);
    stopDeferred.resolve(liveBootstrap(stoppedThread));
    await waitFor(() => stopButton.disabled);
  });

  it('queues a non-empty composer draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-queue',
      title: 'Running send queue',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-running-send' }),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      queued_turn_count: 1,
      messages: [
        ...runningThread.messages,
        {
          id: 'm-running-send-user',
          role: 'user',
          content: 'continue while running',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => liveBootstrap(launchedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-send-queue',
      prompt: 'continue while running',
    }));
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('continue while running');
  });

  it('compacts a running selected thread without stopping or launching a new turn', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-compact',
      title: 'Running compact',
      status: 'running',
      active_run_id: 'run-compact',
      model_io_status: modelIOStatus({ run_id: 'run-compact' }),
      messages: [
        {
          id: 'm-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(runningThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => liveBootstrap(runningThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact',
      expected_run_id: 'run-compact',
      source: 'slash_command',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
  });

  it('does not execute compact from Enter before chat setup is ready', async () => {
    const selected = thread({
      thread_id: 'thread-compact-needs-setup',
      title: 'Compact needs setup',
      status: 'idle',
      messages: [
        {
          id: 'm-compact-needs-setup-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(selected));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      compactThreadContext,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-settings-surface')));
    expect(compactThreadContext).not.toHaveBeenCalled();
  });

  it('executes compact from the slash menu, scrolls the transcript, and shows an immediate compaction divider', async () => {
    const compactingThread = thread({
      thread_id: 'thread-running-compact-menu',
      title: 'Running compact menu',
      status: 'running',
      active_run_id: 'run-compact-menu',
      model_io_status: modelIOStatus({ run_id: 'run-compact-menu' }),
      messages: [
        {
          id: 'm-compact-menu-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-menu-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const stopThread = vi.fn(async () => liveBootstrap({ ...compactingThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => liveBootstrap(compactingThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLElement;
    let scrollTop = 0;
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 180 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 920 });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));

    (runtime.querySelector('.flower-composer-command-item') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')));
    await waitFor(() => scrollTop === 740);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact-menu',
      expected_run_id: 'run-compact-menu',
      source: 'slash_command',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');

    const timelineNodes = Array.from(runtime.querySelectorAll('[data-flower-message-id], .flower-compaction-divider'));
    expect(timelineNodes.map((node) => (
      node instanceof HTMLElement && node.hasAttribute('data-flower-message-id')
        ? node.getAttribute('data-flower-message-id')
        : `divider:${(node as HTMLElement).getAttribute('data-flower-compaction-status')}`
    ))).toEqual([
      'm-compact-menu-user',
      'm-compact-menu-assistant',
      'divider:compacting',
      'm-compact-menu-assistant',
    ]);

    compactDeferred.resolve(liveBootstrap({
      ...compactingThread,
      timeline_decorations: [{
        decoration_id: 'local-context-compaction-thread-running-compact-menu',
        kind: 'context_compaction',
        ordinal: 999,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-menu-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-menu-real',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: Date.now() + 1_000,
        },
      }],
    }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('keyboard selection completes slash suggestions before executing compact', async () => {
    const runningThread = thread({
      thread_id: 'thread-compact-keyboard-suggest',
      title: 'Compact keyboard suggest',
      status: 'running',
      active_run_id: 'run-compact-keyboard',
      model_io_status: modelIOStatus({ run_id: 'run-compact-keyboard' }),
      messages: [{
        id: 'm-compact-keyboard-user',
        role: 'user',
        content: 'inspect the repository',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(runningThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => textarea.value === '/compact');
    expect(compactThreadContext).not.toHaveBeenCalled();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('stops polling once a real compaction decoration replaces the local pending divider', async () => {
    const idleThread = thread({
      thread_id: 'thread-compact-pending-clears',
      title: 'Compact pending clears',
      status: 'success',
      messages: [
        {
          id: 'm-compact-pending-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-pending-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
    });
    const realCompactionThread = thread({
      ...idleThread,
      context_compactions: [{
        operation_id: 'compact-pending-real',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-pending-real',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-pending-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-pending-real',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const listThreadLiveEvents = vi.fn(async () => ({
      stream_generation: 1,
      events: [],
      next_cursor: 1,
      retained_from_seq: 1,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(realCompactionThread, 2)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')));
    expect(runtime.querySelectorAll('.flower-compaction-divider')).toHaveLength(1);
    const callsAfterRealDecoration = listThreadLiveEvents.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(listThreadLiveEvents).toHaveBeenCalledTimes(callsAfterRealDecoration);
  });

  it('emits a debug event when selected thread live polling times out', async () => {
    vi.useFakeTimers();
    const runningThread = thread({
      thread_id: 'thread-live-timeout-debug',
      title: 'Live timeout debug',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-live-timeout-debug' }),
      messages: [
        {
          id: 'm-live-timeout-user',
          role: 'user',
          content: 'watch live timeout',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const liveRequest = deferred<FlowerLiveEventsResponse>();
    const timeouts: unknown[] = [];
    const onTimeout = (event: Event) => {
      timeouts.push((event as CustomEvent).detail);
    };
    window.addEventListener('redeven:flower-live-events-timeout', onTimeout);
    try {
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [runningThread]),
        loadThread: vi.fn(async () => liveBootstrap(runningThread, 7)),
        listThreadLiveEvents: vi.fn(() => liveRequest.promise),
      });

      await vi.waitFor(() => {
        expect(runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button')).toBeTruthy();
      });
      (runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => {
        expect(timeouts).toHaveLength(1);
      });

      expect(timeouts[0]).toMatchObject({
        thread_id: 'thread-live-timeout-debug',
        cursor: 0,
        stream_generation: 1,
      });
    } finally {
      window.removeEventListener('redeven:flower-live-events-timeout', onTimeout);
    }
  });

  it('keeps a new pending compact divider when the selected thread already has historical compactions', async () => {
    const historicalCompactionThread = thread({
      thread_id: 'thread-compact-pending-history',
      title: 'Compact pending history',
      status: 'success',
      messages: [
        {
          id: 'm-compact-history-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-history-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-history-old',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-history-old',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-history-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-history-old',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [historicalCompactionThread]),
      loadThread: vi.fn(async () => liveBootstrap(historicalCompactionThread)),
      compactThreadContext: vi.fn(() => compactDeferred.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider').length === 2);
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')).toBeTruthy();
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')).toBeTruthy();
  });

  it('replaces a local compact divider when slash compact returns an already-running idle compaction', async () => {
    const alreadyCompactingThread = thread({
      thread_id: 'thread-compact-already-running',
      title: 'Compact already running',
      status: 'success',
      messages: [
        {
          id: 'm-compact-already-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-already-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-already-running',
        phase: 'start',
        status: 'compacting',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 30,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-already-running',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-already-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-already-running',
          phase: 'start',
          status: 'compacting',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 30,
        },
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [alreadyCompactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(alreadyCompactingThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(alreadyCompactingThread, 2)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-already-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-already-running"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider[data-flower-compaction-status="compacting"]').length === 1);
    expect(runtime.querySelector('[data-flower-decoration-id="context-compaction:compact-already-running"]')).toBeTruthy();
  });

  it('allows a normal send while an idle compact request is still pending', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-pending-send',
      title: 'Idle compact pending send',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const launchTurn = vi.fn(async () => liveBootstrap({
      ...compactingThread,
      queued_turn_count: 1,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');

    textarea.value = 'continue after compact starts';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-idle-compact-pending-send',
      prompt: 'continue after compact starts',
    }));
    await waitFor(() => runtime.querySelector('[data-flower-pending-turn]')?.textContent?.includes('continue after compact starts') ?? false);
    expect(runtime.querySelector('[data-flower-pending-turn]')?.getAttribute('data-flower-pending-turn-state')).toBe('queued');
    expect(runtime.querySelector('[data-flower-message-id="m-idle-compact-user"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-id="continue after compact starts"]')).toBeNull();
    expect(compactThreadContext).toHaveBeenCalledTimes(1);
  });

  it('keeps multiple queued pending sends visible while idle compaction is still pending', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-multi-pending',
      title: 'Idle compact multi pending',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-multi-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-multi-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const pendingMessages: string[] = [];
    const launchTurn = vi
      .fn(async (input) => {
        pendingMessages.push(input.message_id ?? '');
        return liveBootstrap({ ...compactingThread, queued_turn_count: pendingMessages.length });
      });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    try {
      const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
      for (const prompt of ['repeat queued follow-up', 'repeat queued follow-up']) {
        textarea.value = prompt;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await waitFor(() => {
          const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
          return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
        });
        (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
        await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
      }
    } finally {
      nowSpy.mockRestore();
    }

    await waitFor(() => launchTurn.mock.calls.length === 2);
    await waitFor(() => runtime.querySelectorAll('[data-flower-pending-turn]').length === 2);
    const pendingText = Array.from(runtime.querySelectorAll('[data-flower-pending-turn]')).map((node) => node.textContent ?? '').join('\n');
    expect((pendingText.match(/repeat queued follow-up/g) ?? []).length).toBe(2);
    expect(pendingMessages).toHaveLength(2);
    expect(pendingMessages[0]).toMatch(/^client_/);
    expect(pendingMessages[1]).toMatch(/^client_/);
    expect(pendingMessages[0]).not.toBe(pendingMessages[1]);
  });

  it('compacts a waiting-approval selected thread with the active run guard', async () => {
    const waitingApprovalThread = thread({
      thread_id: 'thread-waiting-approval-compact',
      title: 'Waiting approval compact',
      status: 'waiting_approval',
      active_run_id: 'run-waiting-approval-compact',
      model_io_status: null,
      approval_actions: [{
        action_id: 'approval-1',
        origin: 'main_tool',
        run_id: 'run-waiting-approval-compact',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        status: 'pending',
        state: 'requested',
        can_approve: true,
        revision: 1,
        version: 1,
        requested_at_ms: 1,
        summary: { label: 'Run command', effects: [], targets: [], flags: [] },
      }],
      messages: [
        {
          id: 'm-approval-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-approval-assistant',
          role: 'assistant',
          content: 'I need to run a command.',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'I need to run a command.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(waitingApprovalThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...waitingApprovalThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => liveBootstrap(waitingApprovalThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingApprovalThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingApprovalThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-waiting-approval-compact',
      expected_run_id: 'run-waiting-approval-compact',
      source: 'slash_command',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('disables composer commands when the selected thread status is read-only', async () => {
    const readOnlyThread = thread({
      thread_id: 'thread-read-only-status',
      title: 'Read-only status',
      status: 'read_only',
      messages: [
        {
          id: 'm-read-only',
          role: 'assistant',
          content: 'This thread is archived.',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'This thread is archived.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(readOnlyThread));
    const launchTurn = vi.fn(async () => liveBootstrap(readOnlyThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [readOnlyThread]),
      loadThread: vi.fn(async () => liveBootstrap(readOnlyThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-read-only-status"] button')));
    (runtime.querySelector('[data-thread-id="thread-read-only-status"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-readonly-chip')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.getAttribute('placeholder')).toContain('Read only');
    const submitButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    submitButton.click();
    await waitFor(() => true, 20);
    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('uses Enter to send a draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send',
      title: 'Running Enter send',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'running' }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send with enter while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-enter-send',
      prompt: 'send with enter while running',
    }));
  });

  it('keeps old agent activity before the queued user message when Enter sends on a running thread', async () => {
    const oldActivity = activityTimeline({
      run_id: 'run-first',
      turn_id: 'm-first-assistant',
      status: 'running',
      items: [activityItem({
        item_id: 'tool-first-terminal',
        tool_id: 'tool-first-terminal',
        tool_name: 'terminal.exec',
        status: 'running',
        renderer: 'terminal',
        label: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE',
        payload: { command: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE' },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-activity-order',
      title: 'Running Enter activity order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [oldActivity],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: 'ENTER_B_DONE',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'ENTER_B_DONE' }],
        },
      ],
    });
    let loadedAfterLaunch = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? launchedThread : runningThread)),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        return liveBootstrap(withLaunchUserMessageID(launchedThread, 'm-second-user', input.message_id ?? 'm-second-user'), 3);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-first-assistant"]')?.textContent?.includes('printf ENTER_A_BEGIN') ?? false);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

	await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('ENTER_B_DONE') ?? false);
	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]?.startsWith('client_')).toBe(true);
	expect(ids[3]).toBe('m-second-assistant');
	const secondUserText = runtime.querySelector(`[data-flower-message-id="${ids[2]}"]`)?.textContent ?? '';
    const secondAssistantText = runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent ?? '';
    expect(secondUserText).toContain('second request');
    expect(secondAssistantText).toContain('ENTER_B_DONE');
    expect(secondAssistantText).not.toContain('ENTER_A_DONE');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('ignores stale live poll snapshots that return after Enter sends on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-stale-poll',
      title: 'Running stale poll',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: 'partial',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: '' }],
        },
      ],
    });
    const stalePoll = deferred<FlowerLiveEventsResponse>();
    let loadedAfterLaunch = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? launchedThread : runningThread, loadedAfterLaunch ? 3 : 1)),
      listThreadLiveEvents: vi.fn(() => stalePoll.promise),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        return liveBootstrap(withLaunchUserMessageID(launchedThread, 'm-second-user', input.message_id ?? 'm-second-user'), 3);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    stalePoll.resolve({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'test-runtime',
        thread_id: 'thread-running-enter-send-stale-poll',
        run_id: 'run-first',
        at_unix_ms: 50,
        kind: 'timeline.replaced',
        payload: { messages: runningThread.messages, stream_generation: 1, snapshot_through_seq: 2 },
      }],
      stream_generation: 1,
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.includes('m-second-assistant');
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]?.startsWith('pending:')).toBe(false);
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('keeps a repeated prompt pending until a new canonical user message arrives', async () => {
    const existingThread = thread({
      thread_id: 'thread-repeat-pending',
      title: 'Repeat pending',
      status: 'idle',
      messages: [
        {
          id: 'm-old-continue',
          role: 'user',
          content: 'continue',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const launchedThread = thread({
      ...existingThread,
      status: 'running',
      messages: existingThread.messages,
      model_io_status: modelIOStatus({ run_id: 'run-repeat' }),
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      launchTurn: vi.fn(async () => liveBootstrap(launchedThread, 2)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-repeat-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-repeat-pending"] button') as HTMLButtonElement).click();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-turn]')));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('m-old-continue');
    expect(ids[1]?.startsWith('pending:client_')).toBe(true);
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('continue');
  });

  it('renders a pending user turn before assistant streaming when live events arrive first', async () => {
    const selected = thread({
      thread_id: 'thread-pending-before-assistant',
      title: 'Pending before assistant',
      status: 'idle',
      messages: [],
    });
    const launchBootstrap = thread({
      ...selected,
      status: 'running',
      messages: [],
      model_io_status: modelIOStatus({ run_id: 'run-pending-before-assistant' }),
    });
    let pollCount = 0;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      launchTurn: vi.fn(async () => liveBootstrap(launchBootstrap, 1)),
      listThreadLiveEvents: vi.fn(async () => {
        pollCount += 1;
        if (pollCount === 1) {
          return {
            stream_generation: 1,
            next_cursor: 1,
            retained_from_seq: 1,
            has_more: false,
            events: [],
          } satisfies FlowerLiveEventsResponse;
        }
        return {
          stream_generation: 1,
          next_cursor: 4,
          retained_from_seq: 1,
          has_more: false,
          events: pollCount === 2
            ? [
                {
                  schema_version: 1,
                  seq: 2,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  at_unix_ms: 2000,
                  kind: 'message.started',
                  payload: {
                    message_id: 'm-assistant-first',
                    role: 'assistant',
                    status: 'streaming',
                    created_at_ms: 2000,
                  },
                },
                {
                  schema_version: 1,
                  seq: 3,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  at_unix_ms: 2001,
                  kind: 'message.block_started',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    block_type: 'markdown',
                  },
                },
                {
                  schema_version: 1,
                  seq: 4,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  at_unix_ms: 2002,
                  kind: 'message.block_delta',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    delta: 'working',
                  },
                },
              ]
            : [],
        } satisfies FlowerLiveEventsResponse;
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button')));
    (runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button') as HTMLButtonElement).click();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start work';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-assistant-first"]')));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    const pendingIndex = ids.findIndex((id) => id?.startsWith('pending:client_'));
    const assistantIndex = ids.indexOf('m-assistant-first');
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeLessThan(assistantIndex);
  });

  it('ignores stale bootstrap reloads that return after sending on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-stale-bootstrap',
      title: 'Running stale bootstrap',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: 'partial old answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial old answer' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: 'new answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'new answer' }],
        },
      ],
    });
    const staleLoad = deferred<FlowerLiveBootstrap>();
    let loadCalls = 0;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          return liveBootstrap(runningThread, 1);
        }
        return staleLoad.promise;
      }),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        return liveBootstrap(withLaunchUserMessageID(launchedThread, 'm-second-user', input.message_id ?? 'm-second-user'), 4);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('new answer') ?? false);
    staleLoad.resolve(liveBootstrap(runningThread, 2));
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.length === 4;
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]?.startsWith('pending:')).toBe(false);
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
	expect(runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent).toContain('new answer');
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('renders the context meter before submit and opens its tooltip on focus', async () => {
    const idleThread = thread({
      thread_id: 'thread-context-meter',
      title: 'Context meter',
      status: 'idle',
      context_usage: {
        run_id: '',
        phase: 'provider_usage',
        input_tokens: 42500,
        context_window_tokens: 100000,
        threshold_tokens: 80000,
        used_ratio: 0.425,
        threshold_ratio: 0.8,
        pressure_status: 'stable',
        updated_at_ms: 42,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread, 1)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context-meter"] button')));
    (runtime.querySelector('[data-thread-id="thread-context-meter"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-submit')));

    const actions = runtime.querySelector('.flower-composer-actions') as HTMLElement;
    const indicator = actions.querySelector('.flower-composer-context-indicator') as HTMLElement | null;
    const progress = actions.querySelector('.flower-composer-context-progress') as HTMLElement | null;
    const submit = actions.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
    const tooltip = actions.querySelector('.flower-composer-context-tooltip') as HTMLElement | null;
    expect(indicator).toBeTruthy();
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.getAttribute('aria-valuenow')).toBe('43');
    expect(submit).toBeTruthy();
    expect(indicator!.compareDocumentPosition(submit!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tooltip?.getAttribute('aria-hidden')).toBe('true');

    progress!.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('data-open') === 'true');
    expect(progress?.getAttribute('aria-describedby')).toBe(tooltip?.id);
    progress!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('aria-hidden') === 'true');
  });

  it('keeps the composer draft when running send fails', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'do not lose this draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-error')));

    expect(runtime.querySelector('.flower-composer-error')?.textContent).toContain('Send failed.');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('do not lose this draft');
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer draft when running send fails without stopping first', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'keep this draft after send fails';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-error')));

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-composer-error')?.textContent).toContain('Send failed.');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep this draft after send fails');
  });

  it('keeps waiting_user threads on Continue instead of stop or send', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-user-continue',
      title: 'Waiting user continue',
      status: 'waiting_user',
      input_request: inputRequest({
        questions: [{
          id: 'details',
          header: 'Details',
          question: 'What should Flower do next?',
          response_mode: 'write',
        }],
      }),
    });
    const stopThread = vi.fn(async () => liveBootstrap(waitingThread));
    const launchTurn = vi.fn(async () => liveBootstrap(waitingThread));
    const submitInput = vi.fn(async () => liveBootstrap({ ...waitingThread, status: 'running', input_request: null }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      stopThread,
      launchTurn,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'answer the waiting prompt';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-continue') as HTMLButtonElement | null;
      return Boolean(button && button.textContent?.includes('Continue') && !button.disabled);
    });
    expect(runtime.querySelector('.flower-composer-submit')).toBeNull();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(submitInput).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-waiting-user-continue',
      answers: {
        details: { text: 'answer the waiting prompt' },
      },
    }));
  });

  it('loads the canonical thread after sending so completed assistant replies appear', async () => {
    const sentThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'running',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const completeThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'success',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-assistant',
          role: 'assistant',
          content: 'Flower verification is complete.',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const launchTurn = vi.fn(async () => liveBootstrap(sentThread));
    const loadThread = vi.fn(async () => liveBootstrap(completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'verify Flower';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    const send = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    send.click();
    await waitFor(() => launchTurn.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Flower verification is complete.') ?? false);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'verify Flower',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-new');
    expect(runtime.textContent).toContain('Flower verification is complete.');
  });

  it('shows a local pending send row while waiting for the canonical timeline', async () => {
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    let launchMessageID = 'm-user-canonical';
    const launchTurn = vi.fn((input) => {
      launchMessageID = input.message_id ?? launchMessageID;
      return sendDeferred.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-canonical-send') {
          return liveBootstrap(thread({
            thread_id: 'thread-canonical-send',
            title: 'Canonical send',
            status: 'running',
            model_io_status: modelIOStatus({ run_id: 'run-1' }),
            messages: [{
              id: launchMessageID,
              role: 'user',
              content: 'inspect the running turn',
              status: 'complete',
              created_at_ms: 10,
            }, {
              id: 'm-assistant-canonical',
              role: 'assistant',
              content: '',
              status: 'streaming',
              active_cursor: true,
              created_at_ms: 20,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'inspect the running turn';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-pending-turn]')?.getAttribute('data-flower-pending-turn-state')).toBe('sending');
    expect(runtime.querySelector('[data-flower-message-id="m-user-canonical"]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');

    sendDeferred.resolve(liveBootstrap(thread({
      thread_id: 'thread-canonical-send',
      title: 'Canonical send',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: launchMessageID,
        role: 'user',
        content: 'inspect the running turn',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-assistant-canonical',
        role: 'assistant',
        content: '',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    })));
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-message-id="${launchMessageID}"]`)));
    expect(runtime.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
  });

  it('shows the accepted run preparing status from launch bootstrap before live events arrive', async () => {
    const acceptedThread = thread({
      thread_id: 'thread-accepted-preparing',
      title: 'Accepted preparing',
      status: 'running',
      model_io_status: modelIOStatus({
        phase: 'preparing',
        run_id: 'run-accepted-preparing',
      }),
      messages: [{
        id: 'm-accepted-user',
        role: 'user',
        content: 'start the model request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-accepted-assistant',
        role: 'assistant',
        content: '',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const reloadDeferred = deferred<FlowerLiveBootstrap>();
    const launchTurn = vi.fn(async () => liveBootstrap(acceptedThread, 1));
    const loadThread = vi.fn(() => reloadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start the model request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'start the model request',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-accepted-preparing');
    expect(runtime.querySelector('.flower-model-status-text')?.textContent).toBe('Preparing model request...');
    expect(runtime.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Preparing model request');
    expect(runtime.querySelector('.flower-model-status-indicator')?.getAttribute('data-model-io-phase')).toBe('preparing');
    expect(runtime.querySelector('[data-flower-message-id] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('.flower-chat-transcript .flower-model-status-indicator')).toBeNull();

    reloadDeferred.resolve(liveBootstrap({
      ...acceptedThread,
      status: 'success',
      model_io_status: null,
      messages: acceptedThread.messages.map((message) => (
        message.role === 'assistant'
          ? { ...message, status: 'complete', active_cursor: false, content: 'done', blocks: [{ type: 'markdown', content: 'done' }] }
          : message
      )),
    }, 2));
    await waitFor(() => runtime.textContent?.includes('done') ?? false);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('does not synthesize timeline rows while the handler is still resolving', async () => {
    const handlerDeferred = deferred<FlowerRouterDecision>();
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const launchTurn = vi.fn(() => sendDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-route-settled') {
          return liveBootstrap(thread({
            thread_id: 'thread-route-settled',
            title: 'Route settled',
            status: 'running',
            messages: [{
              id: 'm-route-settled-user',
              role: 'user',
              content: 'show before route settles',
              status: 'complete',
              created_at_ms: 10,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      resolveHandler: vi.fn(() => handlerDeferred.promise),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'show before route settles';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('show before route settles');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();

    handlerDeferred.resolve(decision());
    await waitFor(() => launchTurn.mock.calls.length > 0);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show before route settles',
    }));
    sendDeferred.resolve(liveBootstrap(thread({
      thread_id: 'thread-route-settled',
      title: 'Route settled',
      status: 'running',
      messages: [{
        id: 'm-route-settled-user',
        role: 'user',
        content: 'show before route settles',
        status: 'complete',
        created_at_ms: 10,
      }],
    })));
    await waitFor(() => runtime.textContent?.includes('show before route settles') ?? false);
  });

  it('renders running queued send messages in canonical timeline order', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-order',
      title: 'Running send order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: 'm-first-user',
        role: 'user',
        content: 'first request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-first-assistant',
        role: 'assistant',
        content: 'partial old answer',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
        },
      ],
    });
    let loadedAfterLaunch = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? launchedThread : runningThread)),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' })),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        return liveBootstrap(withLaunchUserMessageID(launchedThread, 'm-second-user', input.message_id ?? 'm-second-user'));
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-order"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

	await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]?.startsWith('pending:')).toBe(false);
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });
});
