import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { observeHistoryBodyLayout } from './historyBodyLayout';
import type { FlowerScrollTailController } from './flowerScrollTail';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('corrects the reading layout in the completion effect without scheduling entrance motion', async () => {
  const animate = vi.fn();
  vi.stubGlobal('Animation', animate);
  const flushLayout = vi.fn();
  const [loading, setLoading] = createSignal(true);
  let dispose!: () => void;
  createRoot(stop => { dispose = stop; observeHistoryBodyLayout(loading,
    { flushLayout } as unknown as FlowerScrollTailController); });
  setLoading(false);
  await Promise.resolve();
  expect(flushLayout).toHaveBeenCalledWith(false);
  expect(animate).not.toHaveBeenCalled();
  setLoading(false);
  await Promise.resolve();
  expect(flushLayout).toHaveBeenCalledOnce();
  dispose();
});

it('corrects geometry only when the loading presentation changes to complete', async () => {
  const flushLayout = vi.fn();
  let dispose!: () => void;
  let setPending!: (value: { bytes: number; retained: boolean } | undefined) => void;
  createRoot(cleanup => {
    dispose = cleanup;
    const [pending, set] = createSignal<{ bytes: number; retained: boolean } | undefined>({ bytes: 1, retained: true });
    setPending = set;
    observeHistoryBodyLayout(() => Boolean(pending() && !pending()!.retained), { flushLayout } as unknown as FlowerScrollTailController);
  });
  try {
    await Promise.resolve();
    for (let bytes = 2; bytes < 102; bytes++) setPending({ bytes, retained: true });
    expect(flushLayout).not.toHaveBeenCalled();
    setPending({ bytes: 102, retained: false });
    for (let bytes = 103; bytes < 203; bytes++) setPending({ bytes, retained: false });
    expect(flushLayout).not.toHaveBeenCalled();
    setPending(undefined);
    await Promise.resolve();
    expect(flushLayout).toHaveBeenCalledExactlyOnceWith(false);
    setPending({ bytes: 204, retained: true });
    expect(flushLayout).toHaveBeenCalledOnce();
    setPending({ bytes: 205, retained: false });
    setPending({ bytes: 206, retained: true });
    await Promise.resolve();
    expect(flushLayout).toHaveBeenCalledTimes(2);
  } finally { dispose(); }
});

it('does not correct a detached viewport after the owning message is disposed', async () => {
  const flushLayout = vi.fn();
  const [loading, setLoading] = createSignal(true);
  const dispose = createRoot(stop => {
    observeHistoryBodyLayout(loading, { flushLayout } as unknown as FlowerScrollTailController);
    return stop;
  });
  setLoading(false);
  expect(flushLayout).not.toHaveBeenCalled();
  dispose();
  await Promise.resolve();
  expect(flushLayout).not.toHaveBeenCalled();
});
