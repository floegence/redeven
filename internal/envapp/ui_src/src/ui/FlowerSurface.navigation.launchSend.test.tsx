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
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface navigation launch/send', () => {
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
