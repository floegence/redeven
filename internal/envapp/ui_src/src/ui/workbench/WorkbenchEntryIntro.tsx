import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { WorkbenchState, WorkbenchWidgetItem } from '@floegence/floe-webapp-core/workbench';
import { Motion } from 'solid-motionone';
import { REDEVEN_WORKBENCH_WIDGET_ID_ATTR } from './surface/workbenchInputRouting';

export type WorkbenchEntryIntroFrameSize = Readonly<{
  width: number;
  height: number;
}>;

export interface WorkbenchEntryIntroProps {
  state: () => WorkbenchState;
  frameSize: () => WorkbenchEntryIntroFrameSize;
  surfaceHost: () => HTMLElement | undefined;
  sequence: () => number;
  onStart?: () => void;
  onComplete?: () => void;
}

type IntroCard = Readonly<{
  widget: WorkbenchWidgetItem;
  source: HTMLElement;
  startTransform: string;
  finalTransform: string;
  delayMs: number;
  restore: () => void;
}>;

const INTRO_BASE_DELAY_MS = 36;
const INTRO_MIN_DELAY_STEP_MS = 16;
const INTRO_MAX_DELAY_STEP_MS = 38;
const INTRO_MAX_CASCADE_MS = 280;
const INTRO_CARD_DURATION_MS = 620;
const INTRO_LINGER_MS = 140;
const INTRO_WAIT_FOR_WIDGETS_TIMEOUT_MS = 260;
const INTRO_MIN_RENDERED_EDGE_PX = 16;

function resolveIntroDelayStepMs(cardCount: number): number {
  const normalizedCardCount = Math.max(0, Math.trunc(Number(cardCount)));
  if (normalizedCardCount <= 1) {
    return 0;
  }
  const derivedStepMs = Math.round(INTRO_MAX_CASCADE_MS / (normalizedCardCount - 1));
  return Math.min(INTRO_MAX_DELAY_STEP_MS, Math.max(INTRO_MIN_DELAY_STEP_MS, derivedStepMs));
}

function readMatrix(value: string): DOMMatrix {
  if (!value || value === 'none') {
    return new DOMMatrix();
  }
  return new DOMMatrix(value);
}

function matrixToCSS(matrix: DOMMatrix): string {
  return matrix.is2D
    ? `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`
    : matrix.toString();
}

function createScreenMatrix(args: Readonly<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotateDeg?: number;
}>): DOMMatrix {
  const matrix = new DOMMatrix();
  matrix.translateSelf(args.x, args.y);
  if (args.rotateDeg) {
    matrix.rotateSelf(0, 0, args.rotateDeg);
  }
  matrix.scaleSelf(args.scaleX, args.scaleY);
  return matrix;
}

function readPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function WorkbenchEntryIntro(props: WorkbenchEntryIntroProps) {
  const [phase, setPhase] = createSignal<'enter' | 'settle'>('enter');
  const [startedSequence, setStartedSequence] = createSignal<number | null>(null);
  const [waitingSequence, setWaitingSequence] = createSignal<number | null>(null);
  let startFrame: number | undefined;

  let waitForWidgetsTimer: number | undefined;
  let settleTimer: number | undefined;
  let completeTimer: number | undefined;
  const activeAnimations = new Map<string, { animation: Animation; restore: () => void }>();

  const clearTimers = () => {
    if (waitForWidgetsTimer !== undefined) {
      window.clearTimeout(waitForWidgetsTimer);
      waitForWidgetsTimer = undefined;
    }
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    if (completeTimer !== undefined) {
      window.clearTimeout(completeTimer);
      completeTimer = undefined;
    }
    if (startFrame !== undefined) {
      window.cancelAnimationFrame(startFrame);
      startFrame = undefined;
    }
    for (const { animation, restore } of activeAnimations.values()) {
      animation.cancel();
      restore();
    }
    activeAnimations.clear();
  };

  const playWidgetIntro = (): number | null => {
    const cardsToAnimate = cards();
    if (cardsToAnimate.length === 0) {
      return null;
    }

    for (const card of cardsToAnimate) {
      card.source.style.willChange = 'transform, opacity';
      card.source.style.transition = 'none';
      card.source.style.transformOrigin = '0 0';
      card.source.style.transform = card.startTransform;
      card.source.style.opacity = '0';
    }
    props.onStart?.();

    startFrame = window.requestAnimationFrame(() => {
      startFrame = undefined;
      for (const card of cardsToAnimate) {
        const animation = card.source.animate(
          [
            {
              transform: card.startTransform,
              opacity: 0,
            },
            {
              transform: card.finalTransform,
              opacity: 1,
            },
          ],
          {
            duration: INTRO_CARD_DURATION_MS,
            delay: card.delayMs,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          },
        );
        activeAnimations.set(card.widget.id, { animation, restore: card.restore });
        void animation.finished.finally(() => {
          const active = activeAnimations.get(card.widget.id);
          if (!active || active.animation !== animation) {
            return;
          }
          animation.cancel();
          active.restore();
          activeAnimations.delete(card.widget.id);
        });
      }
    });

    return cardsToAnimate.reduce(
      (maxDuration, card) => Math.max(maxDuration, card.delayMs + INTRO_CARD_DURATION_MS),
      0,
    );
  };

  const start = () => {
    clearTimers();
    setWaitingSequence(null);
    setPhase('enter');

    if (readPrefersReducedMotion()) {
      props.onStart?.();
      completeTimer = window.setTimeout(() => props.onComplete?.(), 80);
      return;
    }

    const totalDurationMs = playWidgetIntro();
    if (totalDurationMs === null) {
      return;
    }

    settleTimer = window.setTimeout(
      () => setPhase('settle'),
      Math.max(220, totalDurationMs - 260),
    );
    completeTimer = window.setTimeout(
      () => props.onComplete?.(),
      totalDurationMs + INTRO_LINGER_MS,
    );
  };
  onCleanup(clearTimers);

  createEffect(() => {
    const nextSequence = props.sequence();
    const nextCards = cards();
    const expectedCardCount = props.state().widgets.length;
    if (
      startedSequence() === nextSequence
      || expectedCardCount === 0
      || nextCards.length === 0
    ) {
      return;
    }

    if (nextCards.length < expectedCardCount) {
      if (waitingSequence() === nextSequence) {
        return;
      }
      setWaitingSequence(nextSequence);
      waitForWidgetsTimer = window.setTimeout(() => {
        waitForWidgetsTimer = undefined;
        if (startedSequence() === nextSequence || cards().length === 0) {
          return;
        }
        setStartedSequence(nextSequence);
        start();
      }, INTRO_WAIT_FOR_WIDGETS_TIMEOUT_MS);
      return;
    }

    setStartedSequence(nextSequence);
    start();
  });

  const cards = createMemo<IntroCard[]>(() => {
    const state = props.state();
    const surfaceRoot = props.surfaceHost();
    const frameEl = surfaceRoot?.querySelector<HTMLElement>('[data-floe-workbench-canvas-frame="true"]');
    const frameRect = frameEl?.getBoundingClientRect() ?? surfaceRoot?.getBoundingClientRect();
    const width = Math.max(0, Math.round(frameRect?.width ?? props.frameSize().width));
    const height = Math.max(0, Math.round(frameRect?.height ?? props.frameSize().height));
    if (width <= 0 || height <= 0) {
      return [];
    }
    const centerX = width / 2;
    const centerY = height * 0.48;

    const delayStepMs = resolveIntroDelayStepMs(state.widgets.length);

    return state.widgets
      .slice()
      .sort((left, right) => left.z_index - right.z_index)
      .map((widget, index) => {
        const source = surfaceRoot?.querySelector<HTMLElement>(
          `[${REDEVEN_WORKBENCH_WIDGET_ID_ATTR}="${CSS.escape(widget.id)}"]`,
        );
        if (!source || !frameRect) {
          return null;
        }

        const computed = window.getComputedStyle(source);
        const finalLocalMatrix = readMatrix(computed.transform);
        const sourceRect = source.getBoundingClientRect();
        if (
          sourceRect.width < INTRO_MIN_RENDERED_EDGE_PX
          || sourceRect.height < INTRO_MIN_RENDERED_EDGE_PX
        ) {
          return null;
        }
        const baseWidth = Math.max(1, Number.parseFloat(computed.width) || widget.width);
        const baseHeight = Math.max(1, Number.parseFloat(computed.height) || widget.height);
        const finalScaleX = Math.max(sourceRect.width / baseWidth, 0.0001);
        const finalScaleY = Math.max(sourceRect.height / baseHeight, 0.0001);
        const finalCenterX = sourceRect.left - frameRect.left + sourceRect.width / 2;
        const finalCenterY = sourceRect.top - frameRect.top + sourceRect.height / 2;
        const bloomVectorX = (finalCenterX - centerX) * 0.16;
        const bloomVectorY = (finalCenterY - centerY) * 0.16;
        const orbitAngle = (index - (state.widgets.length - 1) / 2) * 0.48;
        const orbitRadius = 18 + index * 10;
        const orbitX = Math.cos(orbitAngle) * orbitRadius;
        const orbitY = Math.sin(orbitAngle) * orbitRadius * 0.72;
        const finalScreenMatrix = createScreenMatrix({
          x: sourceRect.left - frameRect.left,
          y: sourceRect.top - frameRect.top,
          scaleX: finalScaleX,
          scaleY: finalScaleY,
        });
        const ancestorMatrix = finalScreenMatrix.multiply(finalLocalMatrix.inverse());
        const introScale = 0.28 + Math.min(index * 0.02, 0.08);
        const startScaleX = Math.max(finalScaleX * introScale, 0.0001);
        const startScaleY = Math.max(finalScaleY * introScale, 0.0001);
        const startX = centerX - (baseWidth * startScaleX) / 2 + bloomVectorX + orbitX;
        const startY = centerY - (baseHeight * startScaleY) / 2 + bloomVectorY + orbitY;
        const tiltDeg = (index % 2 === 0 ? -1 : 1) * (3.2 + index * 0.45);
        const startScreenMatrix = createScreenMatrix({
          x: startX,
          y: startY,
          scaleX: startScaleX,
          scaleY: startScaleY,
          rotateDeg: tiltDeg,
        });
        const startLocalMatrix = ancestorMatrix.inverse().multiply(startScreenMatrix);
        const previousInlineTransform = source.style.transform;
        const previousInlineOpacity = source.style.opacity;
        const previousInlineWillChange = source.style.willChange;
        const previousInlineTransition = source.style.transition;
        const previousInlineTransformOrigin = source.style.transformOrigin;
        return {
          widget,
          source,
          startTransform: matrixToCSS(startLocalMatrix),
          finalTransform: computed.transform === 'none' ? 'none' : computed.transform,
          delayMs: INTRO_BASE_DELAY_MS + index * delayStepMs,
          restore: () => {
            source.style.transform = previousInlineTransform;
            source.style.opacity = previousInlineOpacity;
            source.style.willChange = previousInlineWillChange;
            source.style.transition = previousInlineTransition;
            source.style.transformOrigin = previousInlineTransformOrigin;
          },
        };
      })
      .filter((card): card is IntroCard => card !== null);
  });

  return (
    <Show when={cards().length > 0}>
      <div class="workbench-entry-intro" aria-hidden="true">
        <Motion.div
          class="workbench-entry-intro__veil"
          initial={{ opacity: 1 }}
          animate={{ opacity: phase() === 'settle' ? 0.18 : 1 }}
          transition={{ duration: phase() === 'settle' ? 0.34 : 0.12, easing: 'ease-out' }}
        />
      </div>
    </Show>
  );
}
