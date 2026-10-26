import { createEffect, on, type Accessor } from 'solid-js';
import type { FlowerScrollTailController } from './flowerScrollTail';

// A complete historical document enters at its final geometry. The shared
// scroll owner corrects the reading anchor before paint, without height motion.
export function observeHistoryBodyLayout(loading: Accessor<boolean>, scroll: FlowerScrollTailController) {
  createEffect(on(loading, pending => {
    if (!pending) scroll.flushLayout(false);
  }, { defer: true }));
}
