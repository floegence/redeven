import { createEffect, onCleanup } from 'solid-js';
import { MODE_DRAWS, resolvePreset } from 'thinking-orbs/engine';

const ORB_SIZE = 20 as const;
const STATIC_FRAME_SECONDS = 0.6;
export const MANAGED_SERVICE_PROGRESS_ORB_PRESET = 'shaping' as const;
const SHAPING_PRESET = resolvePreset(MANAGED_SERVICE_PROGRESS_ORB_PRESET, ORB_SIZE);
const drawShapingFrame = MODE_DRAWS[SHAPING_PRESET.mode];

export function managedServiceShapingOrbShouldAnimate(input: Readonly<{
  running: boolean;
  reducedMotion: boolean;
  visible: boolean;
  documentHidden: boolean;
}>): boolean {
  return input.running && !input.reducedMotion && input.visible && !input.documentHidden;
}

function darkTheme(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.dataset.theme === 'dark' || current.classList.contains('dark')) return true;
    if (current.dataset.theme === 'light' || current.classList.contains('light')) return false;
    current = current.parentElement;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ManagedServiceShapingOrb(props: Readonly<{ running?: boolean; class?: string }>) {
  let canvasRef: HTMLCanvasElement | undefined;

  createEffect(() => {
    const canvas = canvasRef;
    const running = props.running !== false;
    if (!canvas || typeof CanvasRenderingContext2D === 'undefined') return;

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(ORB_SIZE * pixelRatio);
    canvas.height = Math.round(ORB_SIZE * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let animationFrame = 0;
    let animating = false;
    const paint = (seconds: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, ORB_SIZE, ORB_SIZE);
      drawShapingFrame(context, ORB_SIZE, seconds, darkTheme(canvas), SHAPING_PRESET.opts);
    };
    const stop = () => {
      animating = false;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const tick = () => {
      paint(window.performance.now() / 1_000 * SHAPING_PRESET.speed);
      if (animating) animationFrame = window.requestAnimationFrame(tick);
    };
    const reconcile = () => {
      const shouldAnimate = managedServiceShapingOrbShouldAnimate({
        running,
        reducedMotion: reducedMotion.matches,
        visible,
        documentHidden: document.visibilityState === 'hidden',
      });
      if (shouldAnimate && !animating) {
        animating = true;
        animationFrame = window.requestAnimationFrame(tick);
      } else if (!shouldAnimate) {
        stop();
        paint(STATIC_FRAME_SECONDS);
      }
    };

    paint(STATIC_FRAME_SECONDS);
    const intersectionObserver = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        reconcile();
      });
    intersectionObserver?.observe(canvas);
    const themeObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => paint(animating ? window.performance.now() / 1_000 * SHAPING_PRESET.speed : STATIC_FRAME_SECONDS));
    let themeNode: HTMLElement | null = canvas;
    while (themeNode && themeObserver) {
      themeObserver.observe(themeNode, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      themeNode = themeNode.parentElement;
    }
    const handleVisibilityChange = () => reconcile();
    const handleReducedMotionChange = () => reconcile();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    reducedMotion.addEventListener('change', handleReducedMotionChange);
    reconcile();

    onCleanup(() => {
      stop();
      intersectionObserver?.disconnect();
      themeObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.removeEventListener('change', handleReducedMotionChange);
    });
  });

  return (
    <canvas
      ref={canvasRef}
      class={props.class ?? 'block h-5 w-5 shrink-0'}
      data-managed-service-shaping-orb
      data-running={props.running === false ? 'false' : 'true'}
      aria-hidden="true"
    />
  );
}
