import { describe, expect, it } from 'vitest';
import type { WorkbenchWidgetItem } from '@floegence/floe-webapp-core/workbench';

import {
  pruneWorkbenchFocusHistory,
  recordWorkbenchFocus,
  resolveWorkbenchFocusFallback,
} from './workbenchFocusHistory';

function widget(id: string, type = 'redeven.files'): WorkbenchWidgetItem {
  return {
    id,
    type,
    title: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z_index: 1,
    created_at_unix_ms: 1,
  };
}

describe('workbenchFocusHistory', () => {
  it('records the latest selected widget first while pruning stale entries', () => {
    expect(recordWorkbenchFocus(
      ['widget-files-1', 'widget-closed', 'widget-files-1'],
      [widget('widget-files-1'), widget('widget-preview-1', 'redeven.preview')],
      'widget-preview-1',
    )).toEqual(['widget-preview-1', 'widget-files-1']);
  });

  it('falls back to the latest live widget that was not just closed', () => {
    expect(resolveWorkbenchFocusFallback(
      ['widget-preview-1', 'widget-files-1', 'widget-terminal-1'],
      [widget('widget-files-1'), widget('widget-terminal-1', 'redeven.terminal')],
      ['widget-preview-1'],
    )).toBe('widget-files-1');
  });

  it('does not revive widgets that were already removed', () => {
    expect(resolveWorkbenchFocusFallback(
      ['widget-preview-1', 'widget-files-1'],
      [],
      ['widget-preview-1'],
    )).toBeNull();
    expect(pruneWorkbenchFocusHistory(
      ['widget-preview-1', 'widget-files-1'],
      [widget('widget-preview-1', 'redeven.preview')],
    )).toEqual(['widget-preview-1']);
  });
});
