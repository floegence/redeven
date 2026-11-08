import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

/** Product decoration only; never overlays or interacts with a live plugin surface. */
export function PluginCreationCanvasBackground(props: { active: boolean }) {
  let canvas!: HTMLDivElement;
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden);
  const [intersecting, setIntersecting] = createSignal(true);
  const active = () => props.active && documentVisible() && intersecting();
  onMount(() => {
    const region = canvas.parentElement!;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const forcedColors = matchMedia('(forced-colors: active)');
    let frame = 0;
    let clientX = 0, clientY = 0;
    let x = 0, y = 0, previousTime = 0;
    let following = false;
    const resetPointer = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      following = false;
      canvas.dataset.pointerActive = 'false';
    };
    const canFollow = () => active() && !reducedMotion.matches && !forcedColors.matches;
    const followPointer = (time: number) => {
      frame = 0;
      if (!canFollow()) return resetPointer();
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return resetPointer();
      const targetX = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
      const targetY = Math.max(0, Math.min(bounds.height, clientY - bounds.top));
      // Time-based easing is consistent on both 60 Hz and high-refresh displays.
      const blend = 1 - Math.exp(-Math.min(time - previousTime, 64) / 75);
      x = following ? x + (targetX - x) * blend : targetX;
      y = following ? y + (targetY - y) * blend : targetY;
      following = true;
      previousTime = time;
      canvas.style.setProperty('--canvas-pointer-x', `${x.toFixed(2)}px`);
      canvas.style.setProperty('--canvas-pointer-y', `${y.toFixed(2)}px`);
      canvas.dataset.pointerActive = 'true';
      // No permanent animation loop: settle completely when the pointer stops.
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > .1) {
        frame = requestAnimationFrame(followPointer);
      }
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons || !canFollow()) return resetPointer();
      clientX = event.clientX;
      clientY = event.clientY;
      if (!frame) {
        previousTime = performance.now();
        frame = requestAnimationFrame(followPointer);
      }
    };
    const syncVisibility = () => setDocumentVisible(!document.hidden);
    const observer = new IntersectionObserver(entries => setIntersecting(entries.some(entry => entry.isIntersecting)));
    observer.observe(canvas);
    region.addEventListener('pointermove', movePointer, { passive: true });
    region.addEventListener('pointerleave', resetPointer);
    region.addEventListener('pointercancel', resetPointer);
    region.addEventListener('pointerdown', resetPointer);
    region.addEventListener('scroll', resetPointer, { passive: true, capture: true });
    window.addEventListener('blur', resetPointer);
    reducedMotion.addEventListener('change', resetPointer);
    forcedColors.addEventListener('change', resetPointer);
    document.addEventListener('visibilitychange', syncVisibility);
    createEffect(() => { if (!active()) resetPointer(); });
    onCleanup(() => {
      resetPointer();
      observer.disconnect();
      region.removeEventListener('pointermove', movePointer);
      region.removeEventListener('pointerleave', resetPointer);
      region.removeEventListener('pointercancel', resetPointer);
      region.removeEventListener('pointerdown', resetPointer);
      region.removeEventListener('scroll', resetPointer, true);
      window.removeEventListener('blur', resetPointer);
      reducedMotion.removeEventListener('change', resetPointer);
      forcedColors.removeEventListener('change', resetPointer);
      document.removeEventListener('visibilitychange', syncVisibility);
    });
  });
  return (
    <div ref={canvas} class="plugin-creation-atmosphere" aria-hidden="true" data-active={active()} data-pointer-active="false">
      <span class="plugin-creation-atmosphere-grid" />
      <span class="plugin-creation-atmosphere-light" />
      <svg class="plugin-creation-atmosphere-contours" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <path d="M-160 550C90 550 85 115 400 115S770 420 980 235s380-140 420-70" />
        <path d="M-120 625C140 625 125 160 430 160S795 465 1010 280s350-125 420-70" />
        <path d="M-80 700C190 700 165 205 460 205S820 510 1040 325s320-110 420-70" />
      </svg>
      <span class="plugin-creation-atmosphere-pointer" />
    </div>
  );
}
