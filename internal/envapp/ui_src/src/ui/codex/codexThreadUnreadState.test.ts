import { describe, expect, it } from 'vitest';

import {
  buildCodexThreadReadStateBaseline,
  codexThreadHasUnreadFromSnapshot,
  markCodexThreadReadFromSnapshot,
} from './codexThreadUnreadState';

describe('codexThreadUnreadState', () => {
  it('marks a thread as read from the latest updated timestamp', () => {
    const state = markCodexThreadReadFromSnapshot({}, 'thread-1', {
      updatedAtUnixS: 12,
    });

    expect(state).toEqual({
      'thread-1': {
        lastReadUpdatedAtUnixS: 12,
        lastSeenActivitySignature: undefined,
      },
    });
    expect(codexThreadHasUnreadFromSnapshot(state, 'thread-1', { updatedAtUnixS: 12 })).toBe(false);
  });

  it('treats a new activity signature as unread even when the timestamp does not move', () => {
    const state = markCodexThreadReadFromSnapshot({}, 'thread-1', {
      updatedAtUnixS: 12,
      activitySignature: 'status:running',
    });

    expect(codexThreadHasUnreadFromSnapshot(state, 'thread-1', {
      updatedAtUnixS: 12,
      activitySignature: 'status:completed',
    })).toBe(true);
  });

  it('does not create unread when the activity signature stays the same', () => {
    const state = markCodexThreadReadFromSnapshot({}, 'thread-1', {
      updatedAtUnixS: 12,
      activitySignature: 'status:completed',
    });

    expect(codexThreadHasUnreadFromSnapshot(state, 'thread-1', {
      updatedAtUnixS: 12,
      activitySignature: 'status:completed',
    })).toBe(false);
  });

  it('builds a baseline read state for existing threads', () => {
    const baseline = buildCodexThreadReadStateBaseline([
      {
        threadId: 'thread-1',
        snapshot: {
          updatedAtUnixS: 10,
        },
      },
      {
        threadId: 'thread-2',
        snapshot: {
          updatedAtUnixS: 8,
          activitySignature: 'status:completed',
        },
      },
    ]);

    expect(codexThreadHasUnreadFromSnapshot(baseline, 'thread-1', { updatedAtUnixS: 10 })).toBe(false);
    expect(codexThreadHasUnreadFromSnapshot(baseline, 'thread-2', {
      updatedAtUnixS: 8,
      activitySignature: 'status:completed',
    })).toBe(false);
  });
});
