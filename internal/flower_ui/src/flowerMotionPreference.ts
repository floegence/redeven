import { createSignal, onCleanup, onMount } from 'solid-js';

// Floe owns gesture admission/release (including cancel and blur). Flower only
// observes its published DOM contract; it never starts another pointer owner.
export function createFlowerMotionPreference() {
  const media = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const read = () => Boolean(media?.matches || typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-floe-hot-interaction')?.split(/\s+/).some(kind => kind === 'drag' || kind === 'resize'));
  const [reduced, setReduced] = createSignal(read());
  onMount(() => {
    const update = () => setReduced(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-floe-hot-interaction'] });
    media?.addEventListener('change', update);
    update();
    onCleanup(() => { observer.disconnect(); media?.removeEventListener('change', update); });
  });
  return reduced;
}
