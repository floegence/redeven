import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

describe('stable disclosure state', () => {
  it.each(['none', 'manual', 'automatic'] as const)('settles the %s default once without reopening on observation', initial => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', initial);
    for (const next of ['automatic', 'manual', 'automatic'] as const) {
      store.observe('turn', next);
      expect(store.expanded('turn', next)).toBe(false);
    }
    dispose();
  }));
  it.each(['none', 'manual'] as const)('retains inspected %s work when it first completes', initial => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', initial);
    store.observe('turn', 'automatic', () => true);
    expect(store.expanded('turn', 'automatic')).toBe(true);
    store.observe('turn', 'automatic', () => false);
    expect(store.expanded('turn', 'automatic')).toBe(true);
    dispose();
  }));
  it('checks reading geometry only at an untouched completion boundary', () => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    const inspected = vi.fn(() => false);
    const anchor = vi.fn();
    store.observe('turn', 'manual', inspected, anchor);
    store.observe('turn', 'manual', inspected, anchor);
    expect(inspected).not.toHaveBeenCalled();
    store.observe('turn', 'automatic', inspected, anchor);
    expect(inspected).toHaveBeenCalledOnce();
    expect(anchor).toHaveBeenCalledOnce();
    store.observe('turn', 'automatic', inspected, anchor);
    store.observe('historical', 'automatic', () => true);
    expect(store.expanded('historical', 'automatic')).toBe(false);
    expect(inspected).toHaveBeenCalledOnce();
    dispose();
  }));
  it.each([false, true])('preserves manual expanded=%s across completion, regrouping and navigation', expanded => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('runtime/thread/turn', 'automatic');
    if (expanded) store.toggle('runtime/thread/turn', 'automatic');
    else { store.toggle('runtime/thread/turn', 'automatic'); store.toggle('runtime/thread/turn', 'automatic'); }
    for (const policy of ['manual', 'automatic', 'manual'] as const) {
      store.observe('runtime/thread/turn', policy);
      store.retainExpanded('runtime/thread/turn');
      expect(store.expanded('runtime/thread/turn', policy)).toBe(expanded);
    }
    expect(store.expanded('other/thread/turn', 'manual')).toBe(true);
    dispose();
  }));
  it('never opens a folded group through observation or inspection', () => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('tools', 'automatic');
    expect(store.expanded('tools', 'automatic')).toBe(false);
    store.retainExpanded('tools');
    expect(store.expanded('tools', 'automatic')).toBe(false);
    store.reveal('tools');
    expect(store.expanded('tools', 'automatic')).toBe(true);
    store.toggle('tools', 'automatic');
    store.retainExpanded('tools');
    expect(store.expanded('tools', 'automatic')).toBe(false);
    dispose();
  }));
});
