// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function waitForAbort(input: FlowerLiveStreamConnectInput): Promise<void> {
  if (input.signal.aborted) return;
  await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
}

describe('Flower initial conversation loading', () => {
  it('keeps the existing loading presentation until the first page, then preserves the draft through remaining pages', async () => {
    const first = deferred<void>();
    const remaining = deferred<void>();
    const surface = renderSurfaceWithAdapter({ ...adapter(true),
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        yield { schema_version: 3, kind: 'ready', baseline_complete: false, observer_id: 'observer' };
        await first.promise;
        yield { schema_version: 3, kind: 'summary.batch', baseline_complete: false, summaries: [thread({ thread_id: 'recent' })] };
        await remaining.promise;
        yield { schema_version: 3, kind: 'summary.batch', baseline_complete: true, summaries: [thread({ thread_id: 'older' })] };
        await waitForAbort(input);
      },
    });
    await flush();
    expect(surface.querySelector('.flower-warmup[aria-busy="true"]')).not.toBeNull();
    expect(surface.querySelector('.flower-chat-shell')).toBeNull();
    expect(surface.querySelector('.flower-composer')).toBeNull();
    expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
    first.resolve();
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="recent"] button')));
    expect(surface.querySelector('.flower-warmup')).toBeNull();
    expect(surface.querySelector('.flower-empty-state')).not.toBeNull();
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Preserve this draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    remaining.resolve();
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="older"] button')));
    expect(surface.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Preserve this draft');
  });

  it('enters the normal empty state after a confirmed empty baseline', async () => {
    const ready = deferred<void>();
    const surface = renderSurfaceWithAdapter({ ...adapter(true),
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        await ready.promise;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [] };
        await waitForAbort(input);
      },
    });
    await flush();
    expect(surface.querySelector('.flower-warmup')).not.toBeNull();
    ready.resolve();
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-state')));
    expect(surface.querySelector('.flower-warmup')).toBeNull();
    expect(surface.textContent).toContain('No conversations yet.');
  });

  it('keeps initial failure and retry inside the same loading presentation without an outdated-state notice', async () => {
    const retry = deferred<void>();
    let attempts = 0;
    const surface = renderSurfaceWithAdapter({ ...adapter(true),
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        if (++attempts === 1) throw Object.assign(new Error('private diagnostic'), { code: 'envelope_encoding_failed' });
        await retry.promise;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [] };
        await waitForAbort(input);
      },
    });
    await waitFor(() => Boolean(surface.querySelector('.flower-warmup button')));
    expect(surface.querySelector('.flower-warmup')?.getAttribute('aria-busy')).toBe('false');
    expect(surface.querySelector('.flower-warmup-indicator')).toBeNull();
    expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
    expect(surface.querySelector('.flower-error-card')).toBeNull();
    expect(surface.textContent).not.toContain('outdated');
    expect(surface.textContent).not.toContain('private diagnostic');
    (surface.querySelector('.flower-warmup button') as HTMLButtonElement).click();
    await waitFor(() => attempts === 2);
    expect(surface.querySelector('.flower-warmup')?.getAttribute('aria-busy')).toBe('true');
    expect(surface.querySelector('.flower-composer')).toBeNull();
    retry.resolve();
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-state')));
  });

  it('keeps the HTTP list path in loading until its result is ready', async () => {
    const list = deferred<ReturnType<typeof thread>[]>();
    const surface = renderSurfaceWithAdapter({ ...adapter(true), disableLiveStream: true, listThreads: vi.fn(() => list.promise) });
    await flush();
    expect(surface.querySelector('.flower-warmup')).not.toBeNull();
    expect(surface.querySelector('.flower-empty-state')).toBeNull();
    list.resolve([]);
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-state')));
  });

  it('keeps initial transport retries in loading and later reconnects in the admitted surface', async () => {
    const initialRetry = deferred<void>();
    const disconnect = deferred<void>();
    const reconnect = deferred<void>();
    let attempts = 0;
    const surface = renderSurfaceWithAdapter({ ...adapter(true),
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        const attempt = ++attempts;
        if (attempt === 1) throw Object.assign(new Error('offline'), { code: 'transport' });
        await (attempt === 2 ? initialRetry.promise : reconnect.promise);
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [] };
        if (attempt === 2) { await disconnect.promise; return; }
        await waitForAbort(input);
      },
    });
    await waitFor(() => attempts === 2);
    expect(surface.querySelector('.flower-warmup')).not.toBeNull();
    expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
    expect(surface.querySelector('.flower-empty-state')).toBeNull();
    initialRetry.resolve();
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-state')));
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Draft through reconnect';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    disconnect.resolve();
    await waitFor(() => attempts === 3);
    expect(surface.querySelector('.flower-warmup')).toBeNull();
    expect(surface.querySelector('.flower-workspace-sync')).not.toBeNull();
    expect(surface.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Draft through reconnect');
    reconnect.resolve();
    await waitFor(() => !surface.querySelector('.flower-workspace-sync'));
  });

  it('keeps the full workspace in loading when a focused conversation arrives before its list', async () => {
    const list = deferred<ReturnType<typeof thread>[]>();
    const focused = thread();
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: () => list.promise,
      loadThread: async () => liveBootstrap(focused) },
    { focusThreadRequest: { request_id: 'early-detail', thread_id: focused.thread_id } });
    await flush();
    expect(surface.querySelector('.flower-warmup')).not.toBeNull();
    expect(surface.querySelector('.flower-chat-shell')).toBeNull();
    list.resolve([focused]);
    await waitFor(() => Boolean(surface.querySelector('[data-flower-message-id]')));
  });

  it.each([
    [401, 'Restore access'], [403, 'Restore access'], [423, 'Unlock access'],
    [426, 'matching app and runtime version'], [429, 'Close unused Flower views'],
  ] as const)('keeps actionable status %i guidance inside the initial loading presentation', async (status, guidance) => {
    const connectLiveStream = vi.fn((): AsyncIterable<FlowerLiveStreamEnvelope> => ({
      [Symbol.asyncIterator]: () => ({ next: async () => { throw Object.assign(new Error('private diagnostic'), { status, code: 'unexpected_status' }); } }),
    }));
    const surface = renderSurfaceWithAdapter({ ...adapter(true), connectLiveStream });
    await waitFor(() => Boolean(surface.querySelector('.flower-warmup button')));
    expect(surface.querySelector('.flower-warmup')?.textContent).toContain(guidance);
    expect(surface.textContent).not.toContain('outdated');
    expect(surface.textContent).not.toContain('private diagnostic');
    expect(surface.querySelector('.flower-chat-shell')).toBeNull();
    expect(connectLiveStream).toHaveBeenCalledTimes(1);
  });

  it('keeps embedded conversation loading and recovery independent of the sidebar inventory', async () => {
    const list = deferred<ReturnType<typeof thread>[]>();
    const detail = deferred<ReturnType<typeof liveBootstrap>>();
    const focused = thread();
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: () => list.promise,
      loadThread: () => detail.promise }, {
      embeddedConversation: { scope: 'initial-embedded', threadID: focused.thread_id,
        render: parts => <div data-embedded>{parts.conversation}{parts.composer}</div> },
    });
    await waitFor(() => Boolean(surface.querySelector('.flower-chat-notices [role="status"]')));
    expect(surface.querySelectorAll('.flower-chat-notices .flower-thread-wave-bar')).toHaveLength(4);
    expect(surface.querySelector('.flower-warmup')).toBeNull();
    detail.resolve(liveBootstrap(focused));
    await waitFor(() => Boolean(surface.querySelector('[data-flower-message-id]')));
    expect(surface.querySelector('[data-embedded]')).not.toBeNull();
    list.resolve([focused]);
  });
});
