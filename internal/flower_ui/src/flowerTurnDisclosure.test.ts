import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

describe('turn disclosure interface state', () => {
  it('defaults manual-only history to expanded and retains deliberate collapse when details change', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    const protect = vi.fn(() => false);
    expect(store.expanded('legacy', 'manual')).toBe(true);
    store.observe('legacy', 'manual', protect);
    expect(store.settled('legacy')).toBe(true);
    expect(protect).not.toHaveBeenCalled();
    store.toggle('legacy', 'manual');
    expect(store.expanded('legacy', 'manual')).toBe(false);
    store.observe('legacy', 'manual', protect);
    store.observe('legacy', 'automatic', protect);
    expect(store.expanded('legacy', 'automatic')).toBe(false);
    expect(store.expanded('other-runtime/legacy', 'manual')).toBe(true);
    expect(store.expanded('legacy', 'none')).toBe(true);
    dispose();
  }));
  it('retains an abnormal terminal process and publishes its summary without an automatic collapse', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    const protect = vi.fn(() => false);
    store.observe('live', 'none', protect);
    const before = vi.fn((expanded) => expect(expanded).toBe(true));
    expect(store.observe('live', 'manual', protect, before)).toBe(false);
    expect(before).toHaveBeenCalledOnce();
    expect(protect).not.toHaveBeenCalled();
    expect(store.expanded('live', 'manual')).toBe(true);
    store.observe('live', 'automatic', protect);
    expect(store.expanded('live', 'automatic')).toBe(true);
    dispose();
  }));
  it('settles reading protection exactly once and preserves manual choices across navigation', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    const protect = vi.fn(() => true);
    store.observe('runtime/thread/turn', 'none', protect);
    expect(store.expanded('runtime/thread/turn', 'none')).toBe(true);
    store.observe('runtime/thread/turn', 'automatic', protect);
    expect(store.expanded('runtime/thread/turn', 'automatic')).toBe(true);
    protect.mockReturnValue(false);
    store.observe('runtime/thread/turn', 'automatic', protect);
    store.observe('runtime/other/turn', 'automatic', protect);
    expect(protect).toHaveBeenCalledTimes(1);
    expect(store.expanded('runtime/thread/turn', 'automatic')).toBe(true);
    store.toggle('runtime/thread/turn', 'automatic');
    expect(store.expanded('runtime/thread/turn', 'automatic')).toBe(false);
    store.observe('runtime/thread/turn', 'automatic', protect);
    expect(store.expanded('runtime/thread/turn', 'automatic')).toBe(false);
    expect(store.expanded('runtime/other/turn', 'automatic')).toBe(false);
    dispose();
  }));
  it('captures the layout anchor before changing visibility and defaults fresh history to collapsed', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    expect(store.expanded('history', 'automatic')).toBe(false);
    store.observe('live', 'none', () => false);
    const before = vi.fn(() => expect(store.expanded('live', 'automatic')).toBe(true));
    expect(store.observe('live', 'automatic', () => false, before)).toBe(true);
    expect(before).toHaveBeenCalledOnce();
    expect(store.expanded('live', 'automatic')).toBe(false);
    dispose();
  }));
});
