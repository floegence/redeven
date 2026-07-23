// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function emptyThread() {
  return thread({ messages: [], status: 'idle' });
}

function emptyThreadAdapter() {
  const snapshot = emptyThread();
  return {
    snapshot,
    surfaceAdapter: {
      ...adapter(true),
      listThreads: vi.fn(async () => [snapshot]),
      loadThread: vi.fn(async () => liveBootstrap(snapshot)),
    },
  };
}

describe('Flower empty-state presentation', () => {
  it('omits starter suggestions from the expanded companion', async () => {
    const { snapshot, surfaceAdapter } = emptyThreadAdapter();
    const runtime = renderSurfaceWithAdapterProps(surfaceAdapter, {
      presentation: 'companion',
      companionOpen: true,
      engaged: true,
      transcriptVisible: true,
      companionPresenceOwner: true,
      focusThreadRequest: { request_id: 'focus-companion-empty', thread_id: snapshot.thread_id },
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-empty-state')));

    const emptyState = runtime.querySelector('.flower-empty-state') as HTMLElement;
    expect(emptyState.dataset.flowerEmptySuggestions).toBe('hidden');
    expect(emptyState.querySelector('.flower-empty-hero')).not.toBeNull();
    expect(emptyState.querySelector('.flower-empty-hint')).not.toBeNull();
    expect(emptyState.querySelector('.flower-empty-suggestions')).toBeNull();
  });

  it('keeps actionable starter suggestions on the dedicated page', async () => {
    const { snapshot, surfaceAdapter } = emptyThreadAdapter();
    const runtime = renderSurfaceWithAdapterProps(surfaceAdapter, {
      presentation: 'full',
      focusThreadRequest: { request_id: 'focus-full-empty', thread_id: snapshot.thread_id },
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-empty-state')));

    const emptyState = runtime.querySelector('.flower-empty-state') as HTMLElement;
    const suggestionButtons = emptyState.querySelectorAll<HTMLButtonElement>('.flower-empty-suggestions button');
    expect(emptyState.dataset.flowerEmptySuggestions).toBe('visible');
    expect(suggestionButtons).toHaveLength(4);

    suggestionButtons[0]?.click();

    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value)
      .toBe('Review the selected workspace and tell me the highest-value next step.');
  });
});
