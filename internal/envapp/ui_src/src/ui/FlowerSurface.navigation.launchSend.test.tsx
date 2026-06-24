// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

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

  it('stops a running selected thread before sending a non-empty composer draft', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-send',
      title: 'Running stop and send',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...runningThread.messages,
        {
          id: 'm-stop-send-user',
          role: 'user',
          content: 'continue after stop',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const stopThread = vi.fn(async () => liveBootstrap(stoppedThread));
    const launchTurn = vi.fn(async () => liveBootstrap(launchedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-send"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue after stop';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).toHaveBeenCalledWith('thread-running-stop-send');
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-stop-send',
      prompt: 'continue after stop',
    }));
    expect(stopThread.mock.invocationCallOrder[0]).toBeLessThan(launchTurn.mock.invocationCallOrder[0]);
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

  it('compacts a waiting-approval selected thread with the active run guard', async () => {
    const waitingApprovalThread = thread({
      thread_id: 'thread-waiting-approval-compact',
      title: 'Waiting approval compact',
      status: 'waiting_approval',
      active_run_id: 'run-waiting-approval-compact',
      model_io_status: null,
      approval_actions: [{
        action_id: 'approval-1',
        run_id: 'run-waiting-approval-compact',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        status: 'pending',
        state: 'requested',
        can_approve: true,
        revision: 1,
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

  it('uses Enter as stop plus send when a running selected thread has a draft', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-stop-send',
      title: 'Running Enter stop and send',
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

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-stop-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-stop-send"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send with enter after stop';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).toHaveBeenCalledWith('thread-running-enter-stop-send');
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-enter-stop-send',
      prompt: 'send with enter after stop',
    }));
  });

  it('keeps old agent activity before the new user message after Enter stop plus send', async () => {
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
      thread_id: 'thread-running-enter-stop-send-activity-order',
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
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
      messages: runningThread.messages.map((message) => (
        message.id === 'm-first-assistant'
          ? { ...message, status: 'canceled', active_cursor: false }
          : message
      )),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(stoppedThread.messages ?? []),
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
      stopThread: vi.fn(async () => liveBootstrap(stoppedThread, 2)),
      launchTurn: vi.fn(async () => {
        loadedAfterLaunch = true;
        return liveBootstrap(launchedThread, 3);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-stop-send-activity-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-stop-send-activity-order"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-first-assistant"]')?.textContent?.includes('printf ENTER_A_BEGIN') ?? false);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('ENTER_B_DONE') ?? false);
    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toEqual(['m-first-user', 'm-first-assistant', 'm-second-user', 'm-second-assistant']);
    const secondUserText = runtime.querySelector('[data-flower-message-id="m-second-user"]')?.textContent ?? '';
    const secondAssistantText = runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent ?? '';
    expect(secondUserText).toContain('second request');
    expect(secondAssistantText).toContain('ENTER_B_DONE');
    expect(secondAssistantText).not.toContain('ENTER_A_DONE');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('ignores stale live poll snapshots that return after Enter stop plus send', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-stop-send-stale-poll',
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
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
      messages: runningThread.messages.map((message) => (
        message.id === 'm-first-assistant'
          ? { ...message, status: 'canceled', active_cursor: false }
          : message
      )),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(stoppedThread.messages ?? []),
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
      stopThread: vi.fn(async () => liveBootstrap(stoppedThread, 2)),
      launchTurn: vi.fn(async () => {
        loadedAfterLaunch = true;
        return liveBootstrap(launchedThread, 3);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-stop-send-stale-poll"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-stop-send-stale-poll"] button') as HTMLButtonElement).click();
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
        thread_id: 'thread-running-enter-stop-send-stale-poll',
        run_id: 'run-first',
        at_unix_ms: 50,
        kind: 'timeline.replaced',
        payload: { messages: stoppedThread.messages },
      }],
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.includes('m-second-assistant');
    });

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toEqual(['m-first-user', 'm-first-assistant', 'm-second-user', 'm-second-assistant']);
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('ignores stale bootstrap reloads that return after stop plus send', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-send-stale-bootstrap',
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
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
      messages: runningThread.messages.map((message) => (
        message.id === 'm-first-assistant'
          ? { ...message, status: 'canceled', active_cursor: false }
          : message
      )),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(stoppedThread.messages ?? []),
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
    let loadedAfterLaunch = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? stoppedThread : runningThread, loadedAfterLaunch ? 2 : 1)),
      stopThread: vi.fn(async () => liveBootstrap(stoppedThread, 2)),
      launchTurn: vi.fn(async () => {
        loadedAfterLaunch = true;
        return liveBootstrap(launchedThread, 4);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-send-stale-bootstrap"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-send-stale-bootstrap"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('new answer') ?? false);
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.length === 4;
    });

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toEqual(['m-first-user', 'm-first-assistant', 'm-second-user', 'm-second-assistant']);
    expect(runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent).toContain('new answer');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('keeps the composer draft when stop fails before stop plus send', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-fails',
      title: 'Running stop fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => {
      throw new Error('Stop failed.');
    });
    const launchTurn = vi.fn(async () => liveBootstrap(runningThread));
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

    expect(runtime.querySelector('.flower-composer-error')?.textContent).toContain('Stop failed.');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('do not lose this draft');
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('keeps the composer draft when stop plus send fails after stopping', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-fails-after-stop',
      title: 'Running send fails after stop',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopThread = vi.fn(async () => liveBootstrap(stoppedThread));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    let stopCompleted = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(stopCompleted ? stoppedThread : runningThread)),
      stopThread: vi.fn(async () => {
        stopCompleted = true;
        return stopThread();
      }),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-fails-after-stop"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-fails-after-stop"] button') as HTMLButtonElement).click();
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

    expect(stopThread).toHaveBeenCalledTimes(1);
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-composer-error')?.textContent).toContain('Send failed.');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep this draft after send fails');
  });

  it('keeps waiting_user threads on Continue instead of stop or stop plus send', async () => {
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

  it('does not synthesize timeline rows while send is still in flight', async () => {
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const launchTurn = vi.fn(() => sendDeferred.promise);
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
              id: 'm-user-canonical',
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

    expect(runtime.querySelector('[data-flower-message-role]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');

    sendDeferred.resolve(liveBootstrap(thread({
      thread_id: 'thread-canonical-send',
      title: 'Canonical send',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: 'm-user-canonical',
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
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-user-canonical"]')));
    expect(runtime.textContent).toContain('inspect the running turn');
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
    expect(runtime.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Preparing model request...');
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
    expect(runtime.querySelector('[data-flower-message-role]')).toBeNull();
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

  it('renders stop plus send messages in canonical timeline order', async () => {
    const runningThread = thread({
      thread_id: 'thread-stop-send-order',
      title: 'Stop send order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: 'm-first-user',
        role: 'user',
        content: 'first request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-canceled-assistant',
        role: 'assistant',
        content: 'partial old answer',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
      messages: runningThread.messages.map((message) => (
        message.id === 'm-canceled-assistant'
          ? { ...message, status: 'canceled', active_cursor: false }
          : message
      )),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(stoppedThread.messages ?? []),
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
      stopThread: vi.fn(async () => liveBootstrap(stoppedThread)),
      launchTurn: vi.fn(async () => {
        loadedAfterLaunch = true;
        return liveBootstrap(launchedThread);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stop-send-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-stop-send-order"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toEqual(['m-first-user', 'm-canceled-assistant', 'm-second-user', 'm-second-assistant']);
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });
});
