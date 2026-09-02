import { createEffect, createMemo, onCleanup, onMount } from 'solid-js';
import { MODE_DRAWS, resolvePreset, type OrbState } from 'thinking-orbs/engine';

const ORB_SIZE = 20;
const STATIC_FRAME_SECONDS = 0.6;

export const FLOWER_THINKING_ORB_STATE = 'composing' as const;

type FlowerThinkingOrbProps = Readonly<{
  class?: string;
  running: boolean;
  state?: OrbState;
}>;

function explicitDarkTheme(element: HTMLElement): boolean | undefined {
  let current: HTMLElement | null = element;
  while (current) {
    const theme = current.dataset.theme;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    if (current.classList.contains('dark')) return true;
    if (current.classList.contains('light')) return false;
    current = current.parentElement;
  }
  return undefined;
}

export function FlowerThinkingOrb(props: FlowerThinkingOrbProps) {
  let canvas: HTMLCanvasElement | undefined;
  let mounted = false;
  let visible = true;
  let painted = false;
  let lastFrameSeconds = STATIC_FRAME_SECONDS;
  let frameRequest = 0;
  let frameLoopRunning = false;
  let reducedMotion = false;
  let reducedMotionQuery: MediaQueryList | undefined;
  let darkThemeQuery: MediaQueryList | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let themeObserver: MutationObserver | undefined;

  const state = (): OrbState => props.state ?? FLOWER_THINKING_ORB_STATE;
  const preset = createMemo(() => resolvePreset(state(), ORB_SIZE));
  const darkTheme = (): boolean => (
    canvas ? explicitDarkTheme(canvas) ?? darkThemeQuery?.matches ?? false : false
  );

  const paint = (seconds: number) => {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const backingSize = Math.round(ORB_SIZE * pixelRatio);
    if (canvas.width !== backingSize) canvas.width = backingSize;
    if (canvas.height !== backingSize) canvas.height = backingSize;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, ORB_SIZE, ORB_SIZE);

    const selectedPreset = preset();
    MODE_DRAWS[selectedPreset.mode](context, ORB_SIZE, seconds, darkTheme(), selectedPreset.opts);
    lastFrameSeconds = seconds;
    painted = true;
  };

  const stop = () => {
    frameLoopRunning = false;
    if (frameRequest !== 0) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
  };

  const loop = () => {
    paint((performance.now() / 1_000) * preset().speed);
    if (frameLoopRunning) frameRequest = window.requestAnimationFrame(loop);
  };

  const start = () => {
    if (frameLoopRunning) return;
    frameLoopRunning = true;
    frameRequest = window.requestAnimationFrame(loop);
  };

  const synchronize = () => {
    if (!mounted) return;
    const shouldAnimate = props.running
      && !reducedMotion
      && visible
      && document.visibilityState !== 'hidden';
    if (shouldAnimate) {
      start();
      return;
    }
    stop();
    if (!painted) paint(STATIC_FRAME_SECONDS);
  };

  const repaint = () => {
    if (mounted && painted) paint(lastFrameSeconds);
  };

  createEffect(() => {
    void props.running;
    void preset();
    repaint();
    synchronize();
  });

  onMount(() => {
    mounted = true;
    if (typeof window.matchMedia === 'function') {
      reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      darkThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
    reducedMotion = reducedMotionQuery?.matches ?? false;

    const handleReducedMotion = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      synchronize();
    };
    const handleDarkTheme = () => repaint();
    const handleVisibility = () => synchronize();

    reducedMotionQuery?.addEventListener('change', handleReducedMotion);
    darkThemeQuery?.addEventListener('change', handleDarkTheme);
    document.addEventListener('visibilitychange', handleVisibility);

    if (typeof IntersectionObserver !== 'undefined' && canvas) {
      visible = false;
      intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        synchronize();
      });
      intersectionObserver.observe(canvas);
    }
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(repaint);
      let themeNode: HTMLElement | null = canvas ?? null;
      while (themeNode) {
        themeObserver.observe(themeNode, {
          attributes: true,
          attributeFilter: ['class', 'data-theme'],
        });
        themeNode = themeNode.parentElement;
      }
    }

    paint(STATIC_FRAME_SECONDS);
    synchronize();

    onCleanup(() => {
      mounted = false;
      stop();
      intersectionObserver?.disconnect();
      themeObserver?.disconnect();
      reducedMotionQuery?.removeEventListener('change', handleReducedMotion);
      darkThemeQuery?.removeEventListener('change', handleDarkTheme);
      document.removeEventListener('visibilitychange', handleVisibility);
    });
  });

  return (
    <canvas
      ref={canvas}
      class={props.class}
      data-thinking-orb-state={state()}
      data-running={props.running ? 'true' : 'false'}
      aria-hidden="true"
    />
  );
}
