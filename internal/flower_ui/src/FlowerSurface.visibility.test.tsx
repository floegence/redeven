// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerLiveStreamConnectInput } from './contracts/flowerSurfaceContracts';
import {
  adapter,
  flush,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from '../../envapp/ui_src/src/ui/FlowerSurface.navigation.testHarness';

function setDocumentVisible(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function waitForAbort(input: FlowerLiveStreamConnectInput): Promise<void> {
  if (input.signal.aborted) return;
  await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
}

afterEach(() => setDocumentVisible(true));

describe('Flower workspace stream visibility', () => {
  it('keeps one Desktop workspace SSE while the document is hidden', async () => {
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [] };
      await waitForAbort(input);
    });
    renderSurfaceWithAdapter({
      ...adapter(true),
      keepLiveWhenHidden: true,
      connectLiveStream,
    });

    await waitFor(() => connectLiveStream.mock.calls.length === 1);
    setDocumentVisible(false);
    await flush();
    setDocumentVisible(true);
    await flush();

    expect(connectLiveStream).toHaveBeenCalledTimes(1);
  });

  it('preserves cached detail while a Web workspace stream reconnects', async () => {
    const cached = thread({
      thread_id: 'thread-visible-cache',
      title: 'Visible cache',
      messages: [{
        id: 'message-visible-cache',
        role: 'assistant',
        content: 'Cached transcript remains visible.',
        status: 'complete',
        created_at_ms: 2,
      }],
    });
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [cached] };
      await waitForAbort(input);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      keepLiveWhenHidden: false,
      listThreads: vi.fn(async () => [cached]),
      loadThread: vi.fn(async () => liveBootstrap(cached, 9)),
      connectLiveStream,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-visible-cache"] button')));
    (runtime.querySelector('[data-thread-id="thread-visible-cache"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Cached transcript remains visible.') ?? false);

    setDocumentVisible(false);
    await flush();
    expect(runtime.textContent).toContain('Cached transcript remains visible.');
    setDocumentVisible(true);
    await waitFor(() => connectLiveStream.mock.calls.length === 2);
    expect(runtime.textContent).toContain('Cached transcript remains visible.');
  });
});
