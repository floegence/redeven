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
  glideTransform: string;
  settleTransform: string;
  finalTransform: string;
  delayMs: number;
  restore: () => void;
}>;

const INTRO_BASE_DELAY_MS = 72;
const INTRO_MIN_DELAY_STEP_MS = 42;
const INTRO_MAX_DELAY_STEP_MS = 74;
const INTRO_MAX_CASCADE_MS = 460;
const INTRO_CARD_DURATION_MS = 980;
const INTRO_LINGER_MS = 210;
const INTRO_SETTLE_LEAD_MS = 360;
const INTRO_WAIT_FOR_WIDGETS_TIMEOUT_MS = 320;
const INTRO_MIN_RENDERED_EDGE_PX = 16;
const INTRO_CARD_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const INTRO_OVERLAY_EASING = [0.22, 1, 0.36, 1] as const;

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
              offset: 0,
              transform: card.startTransform,
              opacity: 0,
            },
            {
              offset: 0.58,
              transform: card.glideTransform,
              opacity: 0.84,
            },
            {
              offset: 0.86,
              transform: card.settleTransform,
              opacity: 1,
            },
            {
              offset: 1,
              transform: card.finalTransform,
              opacity: 1,
            },
          ],
          {
            duration: INTRO_CARD_DURATION_MS,
            delay: card.delayMs,
            easing: INTRO_CARD_EASING,
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
      Math.max(320, totalDurationMs - INTRO_SETTLE_LEAD_MS),
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
        const vectorFromCenterX = finalCenterX - centerX;
        const vectorFromCenterY = finalCenterY - centerY;
        const bloomVectorX = vectorFromCenterX * 0.14;
        const bloomVectorY = vectorFromCenterY * 0.14;
        const orbitAngle = (index - (state.widgets.length - 1) / 2) * 0.4;
        const orbitRadius = 16 + index * 9;
        const orbitX = Math.cos(orbitAngle) * orbitRadius;
        const orbitY = Math.sin(orbitAngle) * orbitRadius * 0.72;
        const finalScreenX = sourceRect.left - frameRect.left;
        const finalScreenY = sourceRect.top - frameRect.top;
        const finalScreenMatrix = createScreenMatrix({
          x: finalScreenX,
          y: finalScreenY,
          scaleX: finalScaleX,
          scaleY: finalScaleY,
        });
        const ancestorMatrix = finalScreenMatrix.multiply(finalLocalMatrix.inverse());
        const introScale = 0.36 + Math.min(index * 0.024, 0.12);
        const startScaleX = Math.max(finalScaleX * introScale, 0.0001);
        const startScaleY = Math.max(finalScaleY * introScale, 0.0001);
        const startX = centerX - (baseWidth * startScaleX) / 2 + bloomVectorX + orbitX;
        const startY = centerY - (baseHeight * startScaleY) / 2 + bloomVectorY + orbitY;
        const tiltDeg = (index % 2 === 0 ? -1 : 1) * (2.4 + index * 0.28);
        const glideX = finalScreenX - vectorFromCenterX * 0.12 + orbitX * 0.28;
        const glideY = finalScreenY - vectorFromCenterY * 0.12 + orbitY * 0.24;
        const glideScale = 1.024 - Math.min(index * 0.004, 0.016);
        const settleX = finalScreenX + vectorFromCenterX * 0.03;
        const settleY = finalScreenY + vectorFromCenterY * 0.03;
        const settleScale = 1.008;
        const startScreenMatrix = createScreenMatrix({
          x: startX,
          y: startY,
          scaleX: startScaleX,
          scaleY: startScaleY,
          rotateDeg: tiltDeg,
        });
        const glideScreenMatrix = createScreenMatrix({
          x: glideX,
          y: glideY,
          scaleX: Math.max(finalScaleX * glideScale, 0.0001),
          scaleY: Math.max(finalScaleY * glideScale, 0.0001),
          rotateDeg: tiltDeg * 0.24,
        });
        const settleScreenMatrix = createScreenMatrix({
          x: settleX,
          y: settleY,
          scaleX: Math.max(finalScaleX * settleScale, 0.0001),
          scaleY: Math.max(finalScaleY * settleScale, 0.0001),
          rotateDeg: tiltDeg * 0.08,
        });
        const startLocalMatrix = ancestorMatrix.inverse().multiply(startScreenMatrix);
        const glideLocalMatrix = ancestorMatrix.inverse().multiply(glideScreenMatrix);
        const settleLocalMatrix = ancestorMatrix.inverse().multiply(settleScreenMatrix);
        const previousInlineTransform = source.style.transform;
        const previousInlineOpacity = source.style.opacity;
        const previousInlineWillChange = source.style.willChange;
        const previousInlineTransition = source.style.transition;
        const previousInlineTransformOrigin = source.style.transformOrigin;
        return {
          widget,
          source,
          startTransform: matrixToCSS(startLocalMatrix),
          glideTransform: matrixToCSS(glideLocalMatrix),
          settleTransform: matrixToCSS(settleLocalMatrix),
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
          initial={{ opacity: 0.96 }}
          animate={{ opacity: phase() === 'settle' ? 0.14 : 0.96 }}
          transition={{ duration: phase() === 'settle' ? 0.62 : 0.18, easing: INTRO_OVERLAY_EASING }}
        />
        <Motion.div
          class="workbench-entry-intro__wash"
          initial={{ opacity: 0.16, scale: 0.92 }}
          animate={{
            opacity: phase() === 'settle' ? 0.08 : 0.34,
            scale: phase() === 'settle' ? 1.08 : 1,
          }}
          transition={{ duration: phase() === 'settle' ? 0.8 : 0.46, easing: INTRO_OVERLAY_EASING }}
        />
        <Motion.div
          class="workbench-entry-intro__halo"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: phase() === 'settle' ? 0.1 : 0.52,
            scale: phase() === 'settle' ? 1.16 : 1.02,
          }}
          transition={{ duration: phase() === 'settle' ? 0.88 : 0.58, easing: INTRO_OVERLAY_EASING }}
        />
        <Motion.div
          class="workbench-entry-intro__grid"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{
            opacity: phase() === 'settle' ? 0.04 : 0.12,
            scale: phase() === 'settle' ? 1.02 : 1,
          }}
          transition={{ duration: phase() === 'settle' ? 0.72 : 0.42, easing: INTRO_OVERLAY_EASING }}
        />
      </div>
    </Show>
  );
}
