import { describe, expect, it } from 'vitest';

import {
  composeFollowupOrder,
  composerSnapshotHasContent,
  moveFollowupByDelta,
  reorderFollowupsByIDs,
  shouldAutoloadRecoveredFollowup,
  type FollowupItem,
} from './followupsState';

const baseItems: FollowupItem[] = [
  {
    followup_id: 'fu_1',
    lane: 'queued',
    message_id: 'm_1',
    text: 'first',
    position: 1,
    created_at_unix_ms: 1000,
  },
  {
    followup_id: 'fu_2',
    lane: 'queued',
    message_id: 'm_2',
    text: 'second',
    position: 2,
    created_at_unix_ms: 2000,
  },
  {
    followup_id: 'fu_3',
    lane: 'queued',
    message_id: 'm_3',
    text: 'third',
    position: 3,
    created_at_unix_ms: 3000,
  },
];

describe('followupsState', () => {
  it('moves followups by delta and reindexes positions', () => {
    const moved = moveFollowupByDelta(baseItems, 1, -1);
    expect(composeFollowupOrder(moved)).toEqual(['fu_2', 'fu_1', 'fu_3']);
    expect(moved.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('reorders followups by explicit ID list', () => {
    const reordered = reorderFollowupsByIDs(baseItems, ['fu_3', 'fu_1', 'fu_2']);
    expect(composeFollowupOrder(reordered)).toEqual(['fu_3', 'fu_1', 'fu_2']);
    expect(reordered.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('detects composer content from text or attachments', () => {
    expect(composerSnapshotHasContent({ text: '  hello  ', attachments: [] as string[] })).toBe(true);
    expect(composerSnapshotHasContent({ text: '   ', attachments: ['file'] })).toBe(true);
    expect(composerSnapshotHasContent({ text: '   ', attachments: [] as string[] })).toBe(false);
  });

  it('only autoloads recovered followups when composer is empty', () => {
    expect(shouldAutoloadRecoveredFollowup([{ id: 1 }], { text: '', attachments: [] as string[] })).toBe(true);
    expect(shouldAutoloadRecoveredFollowup([{ id: 1 }], { text: 'draft', attachments: [] as string[] })).toBe(false);
    expect(shouldAutoloadRecoveredFollowup([], { text: '', attachments: [] as string[] })).toBe(false);
  });
});
