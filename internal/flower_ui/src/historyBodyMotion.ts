import { createEffect, on, onCleanup, type Accessor } from 'solid-js';
import type { FlowerScrollTailController } from './flowerScrollTail';

// Only first hydration replaces unknown geometry. Streaming, resizing and
// disclosures retain their existing motion owners.
export function observeHistoryBodyMotion(shell: HTMLElement, content: HTMLElement, loading: Accessor<boolean>, scroll: FlowerScrollTailController, reducedMotion: () => boolean) {
  let measured = loading() ? shell.getBoundingClientRect().height : 0;
  let animation: Animation | undefined;
  let resize: ResizeObserver | undefined;
  let disposed = false;
  createEffect(on(loading, pending => {
    if (pending) { measured = shell.getBoundingClientRect().height; return; }
    if (!measured) return;
    const start = measured; measured = 0;
    queueMicrotask(() => {
      if (disposed || !shell.checkVisibility()) return;
      const next = content.getBoundingClientRect().height;
      if (reducedMotion() || Math.abs(next - start) < 1) { scroll.flushLayout(false); return; }
      const deadline = performance.now() + Math.min(320, Math.max(180, Math.abs(next - start) / 1.2));
      let target = next;
      const settle = () => {
        resize?.disconnect(); resize = undefined;
        animation?.cancel(); animation = undefined;
        if (!disposed) scroll.flushLayout(false);
      };
      const animateTo = (from: number, to: number) => {
        const duration = deadline - performance.now();
        if (duration <= 0 || reducedMotion()) { settle(); return; }
        animation?.cancel();
        const current = shell.animate([{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }],
          { duration, easing: 'linear' });
        animation = current;
        scroll.flushLayout(false);
        void current.finished.then(() => { if (animation === current) settle(); }, () => undefined);
      };
      // Another chunk can arrive during the first transition. Retarget its
      // actual height without extending the deadline or snapping on completion.
      resize = new ResizeObserver(() => {
        const next = content.getBoundingClientRect().height;
        if (Math.abs(next - target) < 1) return;
        target = next;
        animateTo(shell.getBoundingClientRect().height, next);
      });
      resize.observe(content);
      animateTo(start, next);
    });
  }, { defer: true }));
  onCleanup(() => { disposed = true; resize?.disconnect(); animation?.cancel(); });
}
