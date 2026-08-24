import { describe, expect, it } from 'vitest';
import { sortContextActionMenuItems } from './menu';

describe('context action menu ordering', () => {
  it('keeps assistant actions before handoffs and surface actions', () => {
    const sorted = sortContextActionMenuItems([
      { id: 'copy-path' },
      { id: 'browse-files' },
      { id: 'open-in-terminal' },
      { id: 'ask-flower' },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'ask-flower',
      'open-in-terminal',
      'browse-files',
      'copy-path',
    ]);
  });
});
