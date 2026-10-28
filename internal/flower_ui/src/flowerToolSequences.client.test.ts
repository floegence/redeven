import { createComputed, createMemo, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createFlowerSequenceContent, projectFlowerToolSequences } from './flowerToolSequences';
import type { FlowerTimelineEntry, FlowerRenderableMessageBlock } from './flowerTimelineProjection';

it('reprojects only at content boundaries while preserving every live character', () => createRoot(dispose => {
  try {
    const [text, setText] = createSignal('');
    const block: Extract<FlowerRenderableMessageBlock, { type: 'content' }> = {
      type: 'content', key: 'tail:0', block_type: 'markdown', block_index: 0, get content() { return text(); },
    };
    const entries: FlowerTimelineEntry[] = [{ type: 'message', key: 'tail', blocks: [block],
      message: { id: 'tail', thread_id: 'thread', turn_id: 'turn', run_id: 'run', role: 'assistant', content: '', status: 'streaming', live: true, created_at_ms: 1 } }];
    const hasContent = createFlowerSequenceContent(() => entries);
    let projections = 0;
    const project = createMemo(() => { projections++; return projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore: false, hasAfter: false }, hasContent); });
    createComputed(project);
    expect(projections).toBe(1);
    setText('  '); expect(projections).toBe(1);
    setText('First'); expect(projections).toBe(2);
    for (let i = 0; i < 300; i++) setText(previous => previous + '中🌸');
    expect(projections).toBe(2);
    expect(block.content).toBe('First' + '中🌸'.repeat(300));
    setText(''); expect(projections).toBe(3);
  } finally { dispose(); }
}));
