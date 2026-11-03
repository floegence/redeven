import { createComputed, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it } from 'vitest';
import type { FlowerChatMessage } from '../contracts/flowerSurfaceContracts';
import { flowerInputHistoryEntries } from './flowerInputHistory';

it('subscribes to canonical user content without observing streaming assistant fields', () => createRoot(dispose => {
  try {
    const [state, set] = createStore({ messages: [
      { id: 'user', turn_id: 'turn', role: 'user', content: 'Original', status: 'complete', created_at_ms: 1 },
      { id: 'assistant', turn_id: 'turn', role: 'assistant', content: '', status: 'streaming', created_at_ms: 2 },
    ] as { -readonly [K in keyof FlowerChatMessage]: FlowerChatMessage[K] }[] });
    let runs = 0; let result: ReturnType<typeof flowerInputHistoryEntries> = [];
    createComputed(() => { runs++; result = flowerInputHistoryEntries(state.messages); });
    for (let i = 0; i < 100; i++) set('messages', 1, 'content', 'output '.repeat(i));
    expect(runs).toBe(1);
    expect(result).toEqual([{ id: 'user', text: 'Original' }]);
    set('messages', 0, 'content', 'Hydrated user message');
    expect(runs).toBe(2);
    expect(result).toEqual([{ id: 'user', text: 'Hydrated user message' }]);
    set('messages', 0, 'status', 'sending');
    expect(result).toEqual([]);
  } finally { dispose(); }
}));
