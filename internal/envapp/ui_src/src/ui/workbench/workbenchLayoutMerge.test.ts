import { describe, expect, it } from 'vitest';
import { mergeWorkbenchLayoutChanges } from './workbenchLayoutMerge';
const widget = (id: string, x = 1) => ({ widget_id: id, widget_type: 'redeven.plugin', x, y: 2, width: 500, height: 400, z_index: 1, created_at_unix_ms: 1 });
const layout = (widgets: ReturnType<typeof widget>[]) => ({ widgets, sticky_notes: [], annotations: [], background_layers: [] });
describe('unsaved Workbench layout changes', () => {
  it('keeps local edits and concurrent additions without reverting other fields', () => {
    const result = mergeWorkbenchLayoutChanges(layout([widget('a')]), layout([widget('a', 50)]), layout([{ ...widget('a'), height: 800 }, widget('b')]));
    expect(result.widgets).toEqual([{ ...widget('a', 50), height: 800 }, widget('b')]);
  });
  it('does not revive remotely removed widgets or drop local additions', () => {
    expect(mergeWorkbenchLayoutChanges(layout([widget('a')]), layout([widget('a', 50), widget('c')]), layout([widget('b')])).widgets).toEqual([widget('b'), widget('c')]);
  });
});
