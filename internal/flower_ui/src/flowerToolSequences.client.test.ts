import { createComputed, createMemo, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createStore } from 'solid-js/store';
import { createFlowerSequenceTokens, projectFlowerToolSequences } from './flowerToolSequences';
import type { FlowerTimelineEntry, FlowerRenderableMessageBlock } from './flowerTimelineProjection';

it('reprojects only at content boundaries while preserving every live character', () => createRoot(dispose => {
  try {
    const [text, setText] = createSignal('');
    const block: Extract<FlowerRenderableMessageBlock, { type: 'content' }> = {
      type: 'content', key: 'tail:0', block_type: 'markdown', block_index: 0, get content() { return text(); },
    };
    const entries: FlowerTimelineEntry[] = [{ type: 'message', key: 'tail', blocks: [block],
      message: { id: 'tail', thread_id: 'thread', turn_id: 'turn', run_id: 'run', role: 'assistant', content: '', status: 'streaming', live: true, created_at_ms: 1 } }];
    const sequenceTokens = createFlowerSequenceTokens(() => entries);
    let projections = 0;
    const project = createMemo(() => { projections++; return projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore: false, hasAfter: false }, sequenceTokens); });
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

it('classifies retained rows once and follows live, body, preview and replacement boundaries', () => createRoot(dispose => {
  try {
    type Message = Extract<FlowerTimelineEntry, { type: 'message' }>;
    let historicalReads = 0;
    const history: Message[] = Array.from({ length: 600 }, (_, index) => ({ type: 'message', key: 'history-' + index,
      message: { id: 'history-' + index, thread_id: 'thread', turn_id: 'turn', run_id: 'run', get role() { historicalReads++; return 'assistant' as const; }, content: '', status: 'complete', created_at_ms: 1 },
      blocks: [{ type: 'content', key: 'history-' + index, block_index: 0, block_type: 'thinking',
        content: 'Retained reasoning' }],
    }));
    const [live, setLive] = createStore({ live: true, body_pending: { kind: 'text' as const, bytes: 400 }, text: '' });
    const tail: Message = { type: 'message', key: 'tail', message: { ...history[0].message, id: 'tail',
      get live() { return live.live; }, get body_pending() { return live.body_pending; } },
      blocks: [{ type: 'content', key: 'tail', block_index: 0, block_type: 'thinking', get content() { return live.text; } }] };
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([...history, tail]);
    const tokens = createFlowerSequenceTokens(entries);
    const prior = tokens(history[0]);
    // Count classification reads, independently of ordered-list invalidation.
    historicalReads = 0;
    for (let index = 0; index < 100; index++) {
      setLive('text', 'reasoning '.repeat(index + 1));
      setEntries([...history, tail]);
    }
    expect(tokens(history[0])).toBe(prior);
    expect(historicalReads).toBe(0);
    expect(tokens(tail)[0]).toMatchObject({ active: true });
    setLive('live', false);
    expect(tokens(tail)[0]).toMatchObject({ active: false });
    const prose: Message = { ...tail, blocks: [{ ...tail.blocks[0], block_type: 'text', get content() { return live.text; } } as Extract<FlowerRenderableMessageBlock, { type: 'content' }>] };
    setLive('text', ''); setEntries([prose]);
    expect(tokens(prose)).toEqual([{ gap: true }]);
    setLive('text', 'Now visible');
    expect(tokens(prose)[0]).toMatchObject({ contentKey: 'tail' });
    const [preview, setPreview] = createStore({ call: { thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
      attempt_id: 'attempt', attempt_epoch: 1, call_id: 'call', name: 'write', arguments_complete: false, preview: { display_name: 'First label' } } });
    const tool: Message = { ...tail, key: 'tool', blocks: [{ type: 'tool_preview', key: 'tool', block_index: 0,
      block: { type: 'tool-call-preview', get call() { return preview.call; } } }] };
    setEntries([tool]);
    expect(tokens(tool)[0]).toMatchObject({ label: 'First label' });
    setPreview('call', { ...preview.call, preview: { display_name: 'Updated label' } });
    expect(tokens(tool)[0]).toMatchObject({ label: 'Updated label' });
    for (const source of [[...history, tail], [prose], [tool], []]) {
      setEntries(source);
      expect(projectFlowerToolSequences(source, 'thread', [], undefined, undefined, undefined, tokens))
        .toEqual(projectFlowerToolSequences(source, 'thread'));
    }
    setEntries([]);
    const afterRemoval = historicalReads;
    setLive('text', 'Disposed');
    expect(historicalReads).toBe(afterRemoval);
  } finally { dispose(); }
}));
