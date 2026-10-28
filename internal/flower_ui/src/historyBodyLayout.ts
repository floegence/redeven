import { createEffect, createMemo, on, type Accessor } from 'solid-js';
import type { FlowerScrollTailController } from './flowerScrollTail';

// A complete historical document enters at its final geometry. The shared
// scroll owner corrects the reading anchor before paint, without height motion.
export function observeHistoryBodyLayout(loading: Accessor<boolean>, scroll: FlowerScrollTailController) {
  // Extents and retained-body receipts can advance while the presentation stays
  // complete. Only a real loading transition needs synchronous layout repair.
  const pending = createMemo(loading);
  createEffect(on(pending, pending => {
    if (!pending) scroll.flushLayout(false);
  }, { defer: true }));
}
