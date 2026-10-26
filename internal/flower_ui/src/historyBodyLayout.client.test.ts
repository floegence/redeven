import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { observeHistoryBodyLayout } from './historyBodyLayout';
import type { FlowerScrollTailController } from './flowerScrollTail';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('corrects the reading layout in the completion effect without scheduling entrance motion', () => {
  const animate = vi.fn();
  vi.stubGlobal('Animation', animate);
  const flushLayout = vi.fn();
  const [loading, setLoading] = createSignal(true);
  let dispose!: () => void;
  createRoot(stop => { dispose = stop; observeHistoryBodyLayout(loading,
    { flushLayout } as unknown as FlowerScrollTailController); });
  setLoading(false);
  expect(flushLayout).toHaveBeenCalledWith(false);
  expect(animate).not.toHaveBeenCalled();
  setLoading(false);
  expect(flushLayout).toHaveBeenCalledOnce();
  dispose();
});
