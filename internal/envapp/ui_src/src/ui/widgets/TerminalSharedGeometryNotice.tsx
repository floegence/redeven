import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { LayoutDashboard } from '@floegence/floe-webapp-core/icons';
import { cn } from '@floegence/floe-webapp-core';
import {
  Show,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from 'solid-js';

import { useI18n } from '../i18n';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import {
  REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS,
  REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS,
} from '../workbench/surface/workbenchTextSelectionSurface';
import type { TerminalSharedGeometryPresentation } from './terminalSharedGeometryPresentation';

type TerminalSharedGeometryNoticeProps = Readonly<{
  presentation: TerminalSharedGeometryPresentation;
  mobile: boolean;
  interactive: boolean;
  fallbackFocus: () => HTMLElement | null;
  surfaceBoundary: () => HTMLElement | null;
  previousFocus?: () => HTMLElement | null;
  nextFocus?: () => HTMLElement | null;
}>;

type AnchorPosition = Readonly<{ x: number; y: number }>;

function sameRect(left: DOMRectReadOnly, right: DOMRectReadOnly): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

export function TerminalSharedGeometryNotice(props: TerminalSharedGeometryNoticeProps) {
  const i18n = useI18n();
  const disclosureId = createUniqueId();
  const titleId = `${disclosureId}-title`;
  const descriptionId = `${disclosureId}-description`;
  const [open, setOpen] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  const [position, setPosition] = createSignal<AnchorPosition>({ x: 0, y: 0 });
  const [maximumSize, setMaximumSize] = createSignal({ width: 320, height: 220 });
  let trigger: HTMLButtonElement | null = null;
  let region: HTMLDivElement | null = null;
  let layer: HTMLDivElement | null = null;
  let anchorRect: DOMRectReadOnly | null = null;
  let anchorWatchFrame: number | null = null;
  let triggerResizeObserver: ResizeObserver | null = null;
  let regionResizeObserver: ResizeObserver | null = null;

  const params = createMemo(() => ({
    cols: props.presentation.effective.cols,
    rows: props.presentation.effective.rows,
  }));
  const localSize = createMemo(() => (
    `${props.presentation.local.cols}\u00d7${props.presentation.local.rows}`
  ));
  const effectiveSize = createMemo(() => (
    `${props.presentation.effective.cols}\u00d7${props.presentation.effective.rows}`
  ));
  const canFocus = (target: HTMLElement | null): target is HTMLElement => Boolean(
    target
    && target.isConnected
    && !target.matches(':disabled, [inert], [inert] *'),
  );
  const focusTarget = (target: HTMLElement | null) => {
    const destination = canFocus(target) ? target : props.fallbackFocus();
    if (canFocus(destination)) destination.focus({ preventScroll: true });
  };
  const close = () => setOpen(false);
  const closeWithFocusFallback = () => {
    const active = document.activeElement;
    if (active && (active === trigger || active === region || layer?.contains(active))) {
      focusTarget(props.fallbackFocus());
    }
    close();
  };
  const stopAnchorWatch = () => {
    if (anchorWatchFrame !== null) window.cancelAnimationFrame(anchorWatchFrame);
    anchorWatchFrame = null;
  };
  const watchAnchor = () => {
    anchorWatchFrame = null;
    if (!open() || !trigger || !anchorRect) return;
    if (!sameRect(anchorRect, trigger.getBoundingClientRect())) {
      closeWithFocusFallback();
      return;
    }
    anchorWatchFrame = window.requestAnimationFrame(watchAnchor);
  };
  const measureOverflow = () => {
    const element = region;
    setOverflowing(Boolean(element && element.scrollHeight > element.clientHeight + 1));
  };
  const openDisclosure = () => {
    if (!props.interactive || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const boundary = props.surfaceBoundary()?.getBoundingClientRect();
    anchorRect = rect;
    setPosition({ x: rect.left, y: rect.bottom + 4 });
    setMaximumSize({
      width: Math.max(0, Math.min(320, (boundary?.width ?? window.innerWidth) - 16)),
      height: Math.max(0, Math.min(220, (boundary?.height ?? window.innerHeight) - 16)),
    });
    setOpen(true);
  };
  const toggle = () => {
    if (open()) close();
    else openDisclosure();
  };

  createEffect(() => {
    void props.presentation.lifecycleEpoch;
    void props.presentation.rendererEpoch;
    void props.presentation.requestEpoch;
    closeWithFocusFallback();
  });

  createRenderEffect(() => {
    if (!props.interactive) closeWithFocusFallback();
  });

  createEffect(() => {
    stopAnchorWatch();
    if (!open()) return;
    queueMicrotask(measureOverflow);
    anchorWatchFrame = window.requestAnimationFrame(watchAnchor);
  });

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!open()) return;
      const target = event.target;
      if (target instanceof Node && (trigger?.contains(target) || layer?.contains(target))) return;
      close();
    };
    const onViewportChange = () => closeWithFocusFallback();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
    });
  });

  onCleanup(() => {
    stopAnchorWatch();
    triggerResizeObserver?.disconnect();
    regionResizeObserver?.disconnect();
    const active = document.activeElement;
    if (active && (active === trigger || active === region || layer?.contains(active))) {
      focusTarget(props.fallbackFocus());
    }
  });

  const setTrigger = (element: HTMLButtonElement) => {
    trigger = element;
    triggerResizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    triggerResizeObserver = new ResizeObserver(() => {
      if (!open() || !trigger || !anchorRect) return;
      if (!sameRect(anchorRect, trigger.getBoundingClientRect())) closeWithFocusFallback();
    });
    triggerResizeObserver.observe(element);
  };

  const setRegion = (element: HTMLDivElement) => {
    region = element;
    regionResizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      regionResizeObserver = new ResizeObserver(measureOverflow);
      regionResizeObserver.observe(element);
    }
    queueMicrotask(measureOverflow);
  };

  const visual = () => (
    <span class="terminal-shared-geometry-notice__chrome">
      <LayoutDashboard class="terminal-shared-geometry-notice__icon" aria-hidden="true" />
      <span class="terminal-shared-geometry-notice__full truncate">
        {i18n.t('terminal.sharedGeometry.compact', params())}
      </span>
      <span class="terminal-shared-geometry-notice__short truncate">
        {i18n.t('terminal.sharedGeometry.short', params())}
      </span>
      <span class="terminal-shared-geometry-notice__label truncate">
        {i18n.t('terminal.sharedGeometry.label')}
      </span>
    </span>
  );

  return (
    <div
      class={cn(
        'terminal-shared-geometry-notice',
        props.mobile && 'terminal-shared-geometry-notice--mobile',
      )}
      data-testid={props.mobile ? 'terminal-shared-geometry-mobile-notice' : 'terminal-shared-geometry-status-notice'}
    >
      <Show
        when={props.interactive}
        fallback={(
          <span
            aria-hidden="true"
            class="terminal-shared-geometry-notice__trigger terminal-shared-geometry-notice__trigger--inert"
            data-terminal-shared-geometry-inert="true"
          >
            {visual()}
          </span>
        )}
      >
        <button
          {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
          ref={setTrigger}
          type="button"
          class="terminal-shared-geometry-notice__trigger"
          aria-label={i18n.t('terminal.sharedGeometry.ariaLabel', params())}
          aria-describedby={descriptionId}
          aria-expanded={open()}
          aria-controls={disclosureId}
          title={i18n.t('terminal.sharedGeometry.ariaLabel', params())}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open()) {
              event.preventDefault();
              event.stopPropagation();
              close();
              trigger?.focus({ preventScroll: true });
              return;
            }
            if (event.key !== 'Tab' || !open()) return;
            if (!overflowing()) {
              close();
              return;
            }
            if (event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              close();
              focusTarget(props.previousFocus?.() ?? null);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            region?.focus({ preventScroll: true });
          }}
        >
          {visual()}
        </button>
        <span id={descriptionId} class="sr-only">
          {i18n.t('terminal.sharedGeometry.triggerDescription')}
        </span>
      </Show>

      <Show when={open() && props.interactive && trigger}>
        <SurfaceFloatingLayer
          owner={trigger}
          layerRef={(element) => {
            layer = element;
          }}
          position={position()}
          estimatedSize={{ width: 320, height: 220 }}
          style={{
            'max-width': `${maximumSize().width}px`,
            'max-height': `${maximumSize().height}px`,
          }}
          class={cn(
            'terminal-shared-geometry-disclosure border shadow-lg',
            redevenSurfaceRoleClass('overlay'),
          )}
        >
          <div
            {...(overflowing()
              ? REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS
              : REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS)}
            ref={setRegion}
            id={disclosureId}
            role="region"
            aria-labelledby={titleId}
            aria-label={overflowing() ? i18n.t('terminal.sharedGeometry.title') : undefined}
            tabIndex={overflowing() ? 0 : undefined}
            class="terminal-shared-geometry-disclosure__viewport"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
                trigger?.focus({ preventScroll: true });
                return;
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                if (event.shiftKey) {
                  trigger?.focus({ preventScroll: true });
                } else {
                  close();
                  focusTarget(props.nextFocus?.() ?? null);
                }
                return;
              }
              if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
                event.stopPropagation();
              }
            }}
          >
            <div class="flex items-center gap-2">
              <LayoutDashboard class="size-3.5 shrink-0 text-[var(--redeven-status-info-foreground)]" aria-hidden="true" />
              <h3 id={titleId} class="text-xs font-semibold text-popover-foreground">
                {i18n.t('terminal.sharedGeometry.title')}
              </h3>
            </div>
            <p class="mt-2.5 text-[11px] leading-[1.5] text-muted-foreground">
              {i18n.t('terminal.sharedGeometry.description', params())}
            </p>
            <dl class="mt-3 grid grid-cols-2 gap-x-4 text-[11px] tabular-nums">
              <div class="min-w-0">
                <dt class="text-muted-foreground">{i18n.t('terminal.sharedGeometry.localSize')}</dt>
                <dd class="mt-1 font-medium text-popover-foreground">{localSize()}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-muted-foreground">{i18n.t('terminal.sharedGeometry.effectiveSize')}</dt>
                <dd class="mt-1 font-medium text-popover-foreground">{effectiveSize()}</dd>
              </div>
            </dl>
            <p class="mt-3 text-[11px] leading-[1.5] text-muted-foreground">
              {i18n.t('terminal.sharedGeometry.resolution')}
            </p>
          </div>
        </SurfaceFloatingLayer>
      </Show>
    </div>
  );
}
