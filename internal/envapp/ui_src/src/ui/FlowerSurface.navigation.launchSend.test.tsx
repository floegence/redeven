// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerRouterDecision,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  decision,
  deferred,
  inputRequest,
  liveBootstrap,
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

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
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
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && button.textContent?.includes('Continue') && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
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

  it('shows a streaming assistant placeholder immediately after send when the running thread has not streamed yet', async () => {
    const sentThread = thread({
      thread_id: 'thread-streaming-placeholder',
      title: 'Flower placeholder',
      status: 'running',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'show the placeholder',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const loadThreadDeferred = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn(() => loadThreadDeferred.promise);
    const launchTurn = vi.fn(async () => liveBootstrap(sentThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'show the placeholder';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-role="user"]')));
    await waitFor(() => Boolean(runtime.querySelector('.flower-streaming-cursor')), 2500);

    expect(runtime.textContent).toContain('show the placeholder');
    expect(runtime.querySelector('.flower-streaming-cursor')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-plain')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(loadThread).toHaveBeenCalled();
  });

  it('shows the submitted user message and streaming cursor while send is still in flight', async () => {
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const launchTurn = vi.fn(() => sendDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
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

    expect(runtime.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="sending"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"][data-flower-message-status="streaming"] .flower-streaming-cursor')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the submitted user message immediately while the handler is still resolving', async () => {
    const handlerDeferred = deferred<FlowerRouterDecision>();
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const launchTurn = vi.fn(() => sendDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
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

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="sending"]')));
    expect(runtime.textContent).toContain('show before route settles');
    expect(runtime.querySelector('[data-flower-message-role="assistant"][data-flower-message-status="streaming"] .flower-streaming-cursor')).toBeTruthy();
    expect(launchTurn).not.toHaveBeenCalled();

    handlerDeferred.resolve(decision());
    await waitFor(() => launchTurn.mock.calls.length > 0);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show before route settles',
    }));
  });
});
