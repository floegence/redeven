import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

describe('turn disclosure interface state', () => {
  it('settles reading protection exactly once and preserves manual choices across navigation', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    const protect = vi.fn(() => true);
    store.observe('runtime/thread/turn', false, protect);
    expect(store.expanded('runtime/thread/turn', false)).toBe(true);
    store.observe('runtime/thread/turn', true, protect);
    expect(store.expanded('runtime/thread/turn', true)).toBe(true);
    protect.mockReturnValue(false);
    store.observe('runtime/thread/turn', true, protect);
    store.observe('runtime/other/turn', true, protect);
    expect(protect).toHaveBeenCalledTimes(1);
    expect(store.expanded('runtime/thread/turn', true)).toBe(true);
    store.toggle('runtime/thread/turn', true);
    expect(store.expanded('runtime/thread/turn', true)).toBe(false);
    store.observe('runtime/thread/turn', true, protect);
    expect(store.expanded('runtime/thread/turn', true)).toBe(false);
    expect(store.expanded('runtime/other/turn', true)).toBe(false);
    dispose();
  }));
  it('captures the layout anchor before changing visibility and defaults fresh history to collapsed', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    expect(store.expanded('history', true)).toBe(false);
    store.observe('live', false, () => false);
    const before = vi.fn(() => expect(store.expanded('live', true)).toBe(true));
    expect(store.observe('live', true, () => false, before)).toBe(true);
    expect(before).toHaveBeenCalledOnce();
    expect(store.expanded('live', true)).toBe(false);
    dispose();
  }));
});
