import { createComputed, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createFlowerComputerActivities } from './flowerComputerActivities';
import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

it('does not revisit historical tools or notify the viewer for unrelated arrivals', () => createRoot(dispose => {
  try {
    let reads = 0;
    const row = (key: string, computer = false, status: FlowerActivityItem['status'] = 'success'): FlowerTimelineEntry => ({
      type: 'message', key, message: { id: key, role: 'assistant', content: '', status: 'complete', created_at_ms: 1 },
      blocks: [{ type: 'activity', key, block_index: 0, block: { type: 'activity-timeline', schema_version: 1,
        thread_id: 'thread', turn_id: 'turn', run_id: 'run',
        summary: { status, severity: 'normal', needs_attention: false, total_items: 1, counts: {} },
        items: [{ item_id: key, tool_id: key, kind: 'tool', tool_name: 'inspect', status, severity: 'normal', needs_attention: false, requires_approval: false,
          get target_refs() { reads++; return computer ? [{ kind: 'computer_target', resource_ref: 'target', label: 'Computer' }] : undefined; } }],
      } }],
    });
    const history = Array.from({ length: 600 }, (_, index) => row('old-' + index));
    const computer = row('computer', true, 'running');
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([...history, computer]);
    const candidates = createFlowerComputerActivities(entries);
    let runs = 0; createComputed(() => { candidates(); runs++; });
    const before = candidates(); reads = 0;
    setEntries([...history, computer, row('new')]);
    expect(reads).toBe(1);
    expect(candidates()).toBe(before);
    expect(runs).toBe(1);
    setEntries([...history, row('computer', true, 'error')]);
    expect(candidates()[0].item.status).toBe('error');
    expect(runs).toBe(2);
    setEntries(history);
    expect(candidates()).toEqual([]);
  } finally { dispose(); }
}));
