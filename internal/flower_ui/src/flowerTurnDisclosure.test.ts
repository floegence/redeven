import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

describe('turn disclosure interface state', () => {
  it('reconsiders only default abnormal expansion when the turn becomes historical', () => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('old', 'manual', () => false);
    const before = vi.fn();
    expect(store.observe('old', 'automatic', () => false, before)).toBe(true);
    expect(before).toHaveBeenCalledWith(false);
    expect(store.expanded('old', 'automatic')).toBe(false);
    store.observe('old', 'automatic', () => true);
    expect(store.expanded('old', 'automatic')).toBe(false);
    dispose();
  }));

  it('retains newly foldable content being inspected without adding another disclosure state', () => createRoot((dispose) => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', 'automatic', () => false);
    expect(store.expanded('turn', 'automatic')).toBe(false);
    store.retainExpanded('turn');
    expect(store.expanded('turn', 'automatic')).toBe(true);
    store.observe('turn', 'automatic', () => false);
    expect(store.expanded('turn', 'automatic')).toBe(true);
    store.toggle('turn', 'automatic');
    expect(store.expanded('turn', 'automatic')).toBe(false);
    store.retainExpanded('turn');
    expect(store.expanded('turn', 'automatic')).toBe(true);
    dispose();
  }));
  it.each([false, true])('preserves explicit expanded=%s across a default policy change', expanded => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', 'manual', () => false);
    store.toggle('turn', 'manual');
    if (expanded) store.toggle('turn', 'manual');
    const protect = vi.fn(() => false);
    store.observe('turn', 'automatic', protect);
    expect(store.expanded('turn', 'automatic')).toBe(expanded);
    expect(protect).not.toHaveBeenCalled();
    dispose();
  }));
  it('checks reading protection once when default abnormal work becomes historical', () => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', 'manual', () => false);
    const protect = vi.fn(() => true);
    store.observe('turn', 'automatic', protect);
    expect(store.expanded('turn', 'automatic')).toBe(true);
    protect.mockReturnValue(false);
    store.observe('turn', 'automatic', protect);
    expect(protect).toHaveBeenCalledOnce();
    expect(store.expanded('turn', 'automatic')).toBe(true);
    store.toggle('turn', 'automatic');
    expect(store.expanded('turn', 'automatic')).toBe(false);
    dispose();
  }));
  it('retains inspected content even while its default is already expanded', () => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', 'manual', () => false);
    store.retainExpanded('turn');
    store.observe('turn', 'automatic', () => false);
    expect(store.expanded('turn', 'automatic')).toBe(true);
    store.toggle('turn', 'automatic');
    expect(store.expanded('turn', 'automatic')).toBe(false);
    dispose();
  }));
  it('defaults the latest abnormal turn to expanded and retains deliberate collapse when details change', () => createRoot((dispose) => {
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
    store.observe('live', 'manual', protect);
    expect(store.expanded('live', 'manual')).toBe(true);
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
