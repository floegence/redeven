// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import {
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const companionCopy = {
  label: 'Switch Flower conversation',
  searchPlaceholder: 'Search conversations...',
  newConversation: 'New conversation',
  empty: 'No matching conversations',
  queued: 'Queued',
  groups: {
    attention: 'Needs attention',
    working: 'Working',
    pinned: 'Pinned',
    recent: 'Recent',
  },
  threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
};

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
  it('uses an icon-only conversation switcher when the companion has no selected thread', async () => {
    let openRequests = 0;
    const runtime = renderSurfaceWithAdapterProps(adapter(true), {
      presentation: 'companion',
      companionOpen: false,
      engaged: true,
      transcriptVisible: true,
      companionPresenceOwner: true,
      companionCopy,
      onCompanionOpenRequest: () => {
        openRequests += 1;
      },
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-companion-thread-trigger')));

    const trigger = runtime.querySelector('.flower-companion-thread-trigger') as HTMLButtonElement;
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.querySelector('.flower-companion-thread-trigger-chevron')).toBeNull();
    expect(trigger.dataset.flowerCompanionEmptySelection).toBe('true');
    expect(trigger.getAttribute('aria-label')).toBe(companionCopy.label);
    expect(trigger.title).toBe(companionCopy.label);
    expect(runtime.querySelector('textarea')?.getAttribute('placeholder')).toBe('Ask Flower anything...');

    trigger.click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-companion-thread-switcher-popover')));
    expect(openRequests).toBe(1);
  });

  it('restores the title and chevron after a thread is selected', async () => {
    const runtime = renderSurfaceWithAdapterProps(adapter(true), {
      presentation: 'companion',
      companionOpen: false,
      engaged: true,
      transcriptVisible: true,
      companionPresenceOwner: true,
      companionCopy,
      focusThreadRequest: { request_id: 'empty-state-select-thread', thread_id: 'thread-1' },
    });

    await waitFor(() => runtime.querySelector('.flower-companion-thread-trigger')?.textContent?.includes('Deploy plan') ?? false);

    const trigger = runtime.querySelector('.flower-companion-thread-trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('Deploy plan');
    expect(trigger.querySelector('.flower-companion-thread-trigger-chevron')).not.toBeNull();
    expect(trigger.dataset.flowerCompanionEmptySelection).toBeUndefined();
  });

  it('omits starter suggestions from the expanded companion', async () => {
    const { surfaceAdapter } = emptyThreadAdapter();
    const runtime = renderSurfaceWithAdapterProps(surfaceAdapter, {
      presentation: 'companion',
      companionOpen: true,
      engaged: true,
      transcriptVisible: true,
      companionPresenceOwner: true,
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-empty-state')));

    const emptyState = runtime.querySelector('.flower-empty-state') as HTMLElement;
    expect(emptyState.dataset.flowerEmptySuggestions).toBe('hidden');
    expect(emptyState.querySelector('.flower-empty-hero')).not.toBeNull();
    expect(emptyState.querySelector('.flower-empty-hint')).not.toBeNull();
    expect(emptyState.querySelector('.flower-empty-suggestions')).toBeNull();
  });

  it('keeps actionable starter suggestions on the dedicated page', async () => {
    const { surfaceAdapter } = emptyThreadAdapter();
    const runtime = renderSurfaceWithAdapterProps(surfaceAdapter, {
      presentation: 'full',
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

  it('does not reuse New Chat onboarding for a selected canonical thread', async () => {
    const { snapshot, surfaceAdapter } = emptyThreadAdapter();
    const runtime = renderSurfaceWithAdapterProps(surfaceAdapter, {
      presentation: 'full',
      focusThreadRequest: { request_id: 'focus-full-empty', thread_id: snapshot.thread_id },
    });

    await waitFor(() => runtime.querySelector('[data-flower-thread-active="true"]') !== null);

    expect(runtime.querySelector('.flower-empty-state')).toBeNull();
    expect(runtime.querySelector('.flower-thread-loading')).not.toBeNull();
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toContain(snapshot.title);
  });
});
