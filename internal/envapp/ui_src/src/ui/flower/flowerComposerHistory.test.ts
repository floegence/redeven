// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  navigateFlowerComposerHistoryDown,
  navigateFlowerComposerHistoryUp,
  pushFlowerComposerHistoryEntry,
  readFlowerComposerHistory,
} from './flowerComposerHistory';

const storageState = new Map<string, string>();

describe('flowerComposerHistory', () => {
  beforeEach(() => {
    vi.useRealTimers();
    storageState.clear();
    window.redevenDesktopStateStorage = {
      getItem: (key) => storageState.get(key) ?? null,
      setItem: (key, value) => {
        storageState.set(key, value);
      },
      removeItem: (key) => {
        storageState.delete(key);
      },
      keys: () => Array.from(storageState.keys()),
    };
  });

  it('stores trimmed entries, de-duplicates by text, and keeps scope isolation', () => {
    pushFlowerComposerHistoryEntry({
      scopeKey: 'env-1',
      text: '  first prompt  ',
      createdAtUnixMs: 10,
    });
    pushFlowerComposerHistoryEntry({
      scopeKey: 'env-1',
      text: 'second prompt',
      createdAtUnixMs: 20,
    });
    pushFlowerComposerHistoryEntry({
      scopeKey: 'env-1',
      text: 'first prompt',
      createdAtUnixMs: 30,
    });
    pushFlowerComposerHistoryEntry({
      scopeKey: 'env-2',
      text: 'other env prompt',
      createdAtUnixMs: 40,
    });

    expect(readFlowerComposerHistory('env-1')).toEqual([
      { text: 'first prompt', createdAtUnixMs: 30 },
      { text: 'second prompt', createdAtUnixMs: 20 },
    ]);
    expect(readFlowerComposerHistory('env-2')).toEqual([
      { text: 'other env prompt', createdAtUnixMs: 40 },
    ]);
  });

  it('navigates up and down while preserving a reversible draft snapshot', () => {
    const entries = [
      { text: 'latest prompt', createdAtUnixMs: 20 },
      { text: 'older prompt', createdAtUnixMs: 10 },
    ];
    const currentDraft = {
      text: 'draft in progress',
      attachments: [{ id: 'attachment-1' }],
    };

    const firstUp = navigateFlowerComposerHistoryUp({
      entries,
      session: null,
      currentDraft,
    });

    expect(firstUp).toEqual({
      session: {
        index: 1,
        savedDraft: currentDraft,
      },
      draft: {
        text: 'latest prompt',
        attachments: [],
      },
    });

    const secondUp = navigateFlowerComposerHistoryUp({
      entries,
      session: firstUp?.session ?? null,
      currentDraft,
    });

    expect(secondUp).toEqual({
      session: {
        index: 2,
        savedDraft: currentDraft,
      },
      draft: {
        text: 'older prompt',
        attachments: [],
      },
    });

    const firstDown = navigateFlowerComposerHistoryDown({
      entries,
      session: secondUp?.session ?? null,
    });

    expect(firstDown).toEqual({
      session: {
        index: 1,
        savedDraft: currentDraft,
      },
      draft: {
        text: 'latest prompt',
        attachments: [],
      },
    });

    const finalDown = navigateFlowerComposerHistoryDown({
      entries,
      session: firstDown?.session ?? null,
    });

    expect(finalDown).toEqual({
      session: null,
      draft: currentDraft,
    });
  });
});
