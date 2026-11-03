import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createFlowerMotionPreference } from './flowerMotionPreference';

afterEach(() => vi.unstubAllGlobals());

it('follows shared gesture ownership and restores accessibility preferences on release', () => {
  let matches = false, attribute: string | null = null;
  let changed!: () => void, mutated!: () => void;
  const remove = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('document', { documentElement: { getAttribute: () => attribute } });
  vi.stubGlobal('window', { matchMedia: () => ({ get matches() { return matches; },
    addEventListener: (_: string, listener: () => void) => { changed = listener; }, removeEventListener: remove }) });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { mutated = callback; }
    observe() {}
    disconnect = disconnect;
  });
  let dispose!: () => void;
  const reduced = createRoot(cleanup => { dispose = cleanup; return createFlowerMotionPreference(); });
  try {
    expect(reduced()).toBe(false);
    for (const value of ['drag', 'drag resize', 'resize']) { attribute = value; mutated(); expect(reduced()).toBe(true); }
    attribute = null; mutated(); expect(reduced()).toBe(false);
    matches = true; changed(); expect(reduced()).toBe(true);
    attribute = 'drag'; mutated(); matches = false; changed(); expect(reduced()).toBe(true);
    attribute = null; mutated(); expect(reduced()).toBe(false);
  } finally { dispose(); }
  expect(remove).toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledOnce();
});
