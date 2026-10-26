import { createComputed, createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';

it('notifies only the group whose disclosure changed, including its first observation', () => createRoot(dispose => {
  try {
    const store = createFlowerTurnDisclosureStore();
    let first = 0, second = 0;
    createComputed(() => { store.expanded('first', 'automatic'); first++; });
    createComputed(() => { store.expanded('second', 'automatic'); second++; });
    store.observe('first', 'manual');
    expect({ first, second }).toEqual({ first: 2, second: 1 });
    store.toggle('first', 'manual');
    expect({ first, second }).toEqual({ first: 3, second: 1 });
    store.observe('second', 'automatic');
    expect({ first, second }).toEqual({ first: 3, second: 2 });
    store.retainExpanded('second');
    expect({ first, second }).toEqual({ first: 3, second: 2 });
    expect(store.expanded('first', 'manual')).toBe(false);
  } finally { dispose(); }
}));
