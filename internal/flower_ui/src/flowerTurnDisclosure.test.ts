import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

describe('stable disclosure state', () => {
  it.each(['none', 'manual', 'automatic'] as const)('applies the %s default only on first observation', initial => createRoot(dispose => {
    const store = createFlowerTurnDisclosureStore();
    store.observe('turn', initial);
    const expanded = initial !== 'automatic';
    for (const next of ['manual', 'automatic', 'manual', 'automatic'] as const) {
      store.observe('turn', next);
      expect(store.expanded('turn', next)).toBe(expanded);
    }
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
