import { describe, expect, it } from 'vitest';

import { buildTabElementId, buildTabPanelElementId, resolveRovingTabTargetId } from './tabNavigation';

describe('tabNavigation', () => {
  it('wraps horizontal navigation and supports Home/End', () => {
    const ids = ['status', 'history'] as const;

    expect(resolveRovingTabTargetId(ids, 'status', 'ArrowRight', 'horizontal')).toBe('history');
    expect(resolveRovingTabTargetId(ids, 'status', 'ArrowLeft', 'horizontal')).toBe('history');
    expect(resolveRovingTabTargetId(ids, 'history', 'Home', 'horizontal')).toBe('status');
    expect(resolveRovingTabTargetId(ids, 'status', 'End', 'horizontal')).toBe('history');
  });

  it('uses vertical arrow keys only for vertical tab lists', () => {
    const ids = ['changes', 'history', 'branches'] as const;

    expect(resolveRovingTabTargetId(ids, 'changes', 'ArrowDown', 'vertical')).toBe('history');
    expect(resolveRovingTabTargetId(ids, 'changes', 'ArrowUp', 'vertical')).toBe('branches');
    expect(resolveRovingTabTargetId(ids, 'changes', 'ArrowRight', 'vertical')).toBeNull();
  });

  it('builds stable ids for related tabs and tabpanels', () => {
    expect(buildTabElementId('git-view', 'changes')).toBe('git-view-tab-changes');
    expect(buildTabPanelElementId('git-view', 'changes')).toBe('git-view-panel-changes');
  });
});
