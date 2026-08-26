import { createEffect, onCleanup } from 'solid-js';
import { MODE_DRAWS, resolvePreset } from 'thinking-orbs/engine';

const RUNTIME_ORB_SIZE = 20 as const;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function runtimeStatusOrbShouldAnimate(input: Readonly<{
  running: boolean;
  reducedMotion: boolean;
  visible: boolean;
  documentHidden: boolean;
}>): boolean {
  return input.running && !input.reducedMotion && input.visible && !input.documentHidden;
}

export function RuntimeStatusOrb(props: Readonly<{
  running: boolean;
  dark: boolean;
}>) {
  let canvasRef: HTMLCanvasElement | undefined;

  createEffect(() => {
    const canvas = canvasRef;
    const running = props.running;
    const dark = props.dark;
    if (!canvas) {
      return;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(RUNTIME_ORB_SIZE * pixelRatio);
    canvas.height = Math.round(RUNTIME_ORB_SIZE * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const preset = resolvePreset('working', RUNTIME_ORB_SIZE);
    const draw = MODE_DRAWS[preset.mode];
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let visible = true;
    let animationFrame = 0;
    let animating = false;

    const paint = (time: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, RUNTIME_ORB_SIZE, RUNTIME_ORB_SIZE);
      draw(context, RUNTIME_ORB_SIZE, time, dark, preset.opts);
    };
    const stop = () => {
      animating = false;
      window.cancelAnimationFrame(animationFrame);
    };
    const tick = () => {
      paint(window.performance.now() / 1_000 * preset.speed);
      if (animating) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };
    const start = () => {
      if (animating || !runtimeStatusOrbShouldAnimate({
        running,
        reducedMotion: reducedMotion.matches,
        visible,
        documentHidden: document.visibilityState === 'hidden',
      })) {
        return;
      }
      animating = true;
      animationFrame = window.requestAnimationFrame(tick);
    };
    const reconcileAnimation = () => {
      if (runtimeStatusOrbShouldAnimate({
        running,
        reducedMotion: reducedMotion.matches,
        visible,
        documentHidden: document.visibilityState === 'hidden',
      })) {
        start();
        return;
      }
      stop();
      paint(reducedMotion.matches ? 0.6 : window.performance.now() / 1_000 * preset.speed);
    };

    paint(reducedMotion.matches ? 0.6 : window.performance.now() / 1_000 * preset.speed);

    const observer = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        reconcileAnimation();
      });
    observer?.observe(canvas);

    const handleVisibilityChange = () => reconcileAnimation();
    const handleReducedMotionChange = () => reconcileAnimation();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    reducedMotion.addEventListener('change', handleReducedMotionChange);
    if (!observer) {
      start();
    }

    onCleanup(() => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.removeEventListener('change', handleReducedMotionChange);
    });
  });

  return (
    <span class="redeven-runtime-status-orb relative block h-5 w-5" aria-hidden="true">
      <canvas
        ref={canvasRef}
        class="block h-5 w-5"
        data-runtime-orb-animation={props.running ? 'running' : 'paused'}
      />
      <span class="redeven-runtime-status-orb__forced-colors absolute inset-1 hidden rounded-full border-2" />
    </span>
  );
}
