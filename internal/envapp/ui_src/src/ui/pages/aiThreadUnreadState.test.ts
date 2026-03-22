import { describe, expect, it } from 'vitest';

import {
  buildThreadReadStateBaseline,
  markThreadReadFromSnapshot,
  threadHasUnreadFromSnapshot,
} from './aiThreadUnreadState';

describe('aiThreadUnreadState', () => {
  it('marks a thread as read from the latest message timestamp', () => {
    const state = markThreadReadFromSnapshot({}, 'thread-1', {
      lastMessageAtUnixMs: 1200,
    });

    expect(state).toEqual({
      'thread-1': {
        lastReadMessageAtUnixMs: 1200,
        lastSeenWaitingPromptId: undefined,
      },
    });
    expect(threadHasUnreadFromSnapshot(state, 'thread-1', { lastMessageAtUnixMs: 1200 })).toBe(false);
  });

  it('treats newer messages as unread after the read watermark', () => {
    const state = markThreadReadFromSnapshot({}, 'thread-1', {
      lastMessageAtUnixMs: 1200,
    });

    expect(threadHasUnreadFromSnapshot(state, 'thread-1', { lastMessageAtUnixMs: 1201 })).toBe(true);
  });

  it('tracks waiting prompts independently from message timestamps', () => {
    const beforeRead = {};
    expect(threadHasUnreadFromSnapshot(beforeRead, 'thread-1', { waitingPromptId: 'prompt-1' })).toBe(true);

    const afterRead = markThreadReadFromSnapshot(beforeRead, 'thread-1', {
      waitingPromptId: 'prompt-1',
    });
    expect(threadHasUnreadFromSnapshot(afterRead, 'thread-1', { waitingPromptId: 'prompt-1' })).toBe(false);
    expect(threadHasUnreadFromSnapshot(afterRead, 'thread-1', { waitingPromptId: 'prompt-2' })).toBe(true);
  });

  it('does not create unread when a previously seen waiting prompt clears', () => {
    const state = markThreadReadFromSnapshot({}, 'thread-1', {
      lastMessageAtUnixMs: 1200,
      waitingPromptId: 'prompt-1',
    });

    expect(threadHasUnreadFromSnapshot(state, 'thread-1', {
      lastMessageAtUnixMs: 1200,
    })).toBe(false);
  });

  it('builds a baseline read state for existing threads', () => {
    const baseline = buildThreadReadStateBaseline([
      {
        threadId: 'thread-1',
        snapshot: {
          lastMessageAtUnixMs: 1200,
        },
      },
      {
        threadId: 'thread-2',
        snapshot: {
          waitingPromptId: 'prompt-2',
        },
      },
    ]);

    expect(threadHasUnreadFromSnapshot(baseline, 'thread-1', { lastMessageAtUnixMs: 1200 })).toBe(false);
    expect(threadHasUnreadFromSnapshot(baseline, 'thread-2', { waitingPromptId: 'prompt-2' })).toBe(false);
  });
});
