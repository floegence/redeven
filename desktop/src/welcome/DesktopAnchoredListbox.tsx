import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { createFloatingPresence } from '@floegence/floe-webapp-core/ui';
import { Portal } from 'solid-js/web';

export type DesktopAnchoredListboxPlacement = 'top' | 'bottom';

export type DesktopAnchoredListboxGeometry = Readonly<{
  placement: DesktopAnchoredListboxPlacement;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}>;

type DesktopAnchoredListboxProps = Readonly<{
  open: boolean;
  anchorRef: HTMLElement | undefined;
  id?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  class?: string;
  maxHeight?: number;
  minHeight?: number;
  width?: number;
  onOverlayRef?: (element: HTMLDivElement | undefined) => void;
  children: JSX.Element;
}>;

const LISTBOX_MARGIN = 8;
const LISTBOX_GAP = 6;
const DEFAULT_MAX_HEIGHT = 320;
const DEFAULT_MIN_HEIGHT = 96;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function scrollDesktopListboxOptionIntoView(
  listbox: HTMLElement | undefined,
  optionID: string,
): void {
  if (!listbox) {
    return;
  }
  const option = listbox.querySelector<HTMLElement>(`#${CSS.escape(optionID)}`);
  if (!option) {
    return;
  }
  const listboxRect = listbox.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  if (optionRect.top < listboxRect.top || optionRect.bottom > listboxRect.bottom) {
    option.scrollIntoView({ block: 'nearest' });
  }
}

// IMPORTANT: Dialog form listboxes must live outside dialog scroll containers.
// A listbox anchored to a field is a floating surface, not form content; keeping
// this geometry in one component prevents footer/overflow clipping regressions.
export function resolveDesktopAnchoredListboxGeometry(options: Readonly<{
  anchorRect: DOMRect;
  overlayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportTopInset: number;
  maxHeight?: number;
  minHeight?: number;
  width?: number;
}>): DesktopAnchoredListboxGeometry {
  const maxHeight = Math.max(1, options.maxHeight ?? DEFAULT_MAX_HEIGHT);
  const minHeight = Math.max(1, Math.min(options.minHeight ?? DEFAULT_MIN_HEIGHT, maxHeight));
  const viewportWidth = Math.max(0, options.viewportWidth);
  const viewportHeight = Math.max(0, options.viewportHeight);
  const viewportTopInset = Math.max(0, options.viewportTopInset);
  const topBoundary = LISTBOX_MARGIN + viewportTopInset;
  const requestedWidth = options.width ?? options.anchorRect.width;
  const width = Math.max(1, Math.min(Math.max(options.anchorRect.width, requestedWidth), Math.max(1, viewportWidth - (LISTBOX_MARGIN * 2))));
  const left = clamp(options.anchorRect.left, LISTBOX_MARGIN, viewportWidth - width - LISTBOX_MARGIN);
  const availableBelow = Math.max(0, viewportHeight - options.anchorRect.bottom - LISTBOX_MARGIN - LISTBOX_GAP);
  const availableAbove = Math.max(0, options.anchorRect.top - topBoundary - LISTBOX_GAP);
  const desiredHeight = Math.max(minHeight, Math.min(maxHeight, options.overlayHeight || maxHeight));
  const placement: DesktopAnchoredListboxPlacement = availableBelow >= Math.min(desiredHeight, minHeight) || availableBelow >= availableAbove
    ? 'bottom'
    : 'top';
  const availableHeight = placement === 'bottom' ? availableBelow : availableAbove;
  const resolvedMaxHeight = Math.max(1, Math.min(maxHeight, availableHeight || maxHeight));
  const renderedHeight = Math.min(desiredHeight, resolvedMaxHeight);
  const rawTop = placement === 'bottom'
    ? options.anchorRect.bottom + LISTBOX_GAP
    : options.anchorRect.top - LISTBOX_GAP - renderedHeight;

  return {
    placement,
    left,
    top: clamp(rawTop, topBoundary, viewportHeight - renderedHeight - LISTBOX_MARGIN),
    width,
    maxHeight: resolvedMaxHeight,
  };
}

function readDesktopTitlebarTopInset(): number {
  if (typeof document === 'undefined') {
    throw new Error('Desktop anchored listbox requires document chrome variables.');
  }
  const rawValue = getComputedStyle(document.documentElement)
    .getPropertyValue('--redeven-desktop-titlebar-height')
    .trim();
  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error('Desktop anchored listbox requires --redeven-desktop-titlebar-height.');
  }
  return Math.max(0, value);
}

export function DesktopAnchoredListbox(props: DesktopAnchoredListboxProps) {
  const [geometry, setGeometry] = createSignal<DesktopAnchoredListboxGeometry | null>(null);
  const [overlayElement, setOverlayElement] = createSignal<HTMLDivElement>();
  const presence = createFloatingPresence({ open: () => props.open, element: overlayElement });
  let frame = 0;
  let positionerRef: HTMLDivElement | undefined;

  const clearFrame = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updateGeometry = () => {
    if (presence.exiting() || !props.anchorRef || !positionerRef || typeof window === 'undefined') {
      return;
    }
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;
    const nextGeometry = resolveDesktopAnchoredListboxGeometry({
      anchorRect: props.anchorRef.getBoundingClientRect(),
      overlayHeight: overlayElement()?.offsetHeight ?? 0,
      viewportWidth,
      viewportHeight,
      viewportTopInset: readDesktopTitlebarTopInset(),
      maxHeight: props.maxHeight,
      minHeight: props.minHeight,
      width: props.width,
    });
    setGeometry({
      ...nextGeometry,
      left: nextGeometry.left + viewportOffsetLeft,
      top: nextGeometry.top + viewportOffsetTop,
    });
  };

  const scheduleGeometryUpdate = () => {
    clearFrame();
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateGeometry();
    });
  };

  createEffect(() => {
    if (!presence.mounted()) {
      clearFrame();
      setGeometry(null);
      return;
    }

    if (presence.exiting()) { clearFrame(); return; }
    if (!overlayElement()) return;
    // Measure the entering pose before the shared presence advances to open.
    updateGeometry();
    scheduleGeometryUpdate();

    const handleViewportChange = () => scheduleGeometryUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = props.anchorRef;
    const nextOverlayRef = positionerRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !nextOverlayRef
      ? null
      : new ResizeObserver(() => scheduleGeometryUpdate());
    if (observer && anchorEl && nextOverlayRef) {
      observer.observe(anchorEl);
      observer.observe(nextOverlayRef);
    }

    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      clearFrame();
    });
  });

  onCleanup(() => {
    clearFrame();
  });

  return (
    <Show when={presence.mounted()}>
      <Portal>
        <div
          ref={positionerRef}
          data-redeven-overlay-positioner=""
          class="fixed z-[240] pointer-events-none"
          style={{
            left: geometry() ? `${geometry()!.left}px` : '0px',
            top: geometry() ? `${geometry()!.top}px` : '0px',
            width: geometry() ? `${geometry()!.width}px` : `${Math.max(props.anchorRef?.getBoundingClientRect().width ?? 0, props.width ?? 0)}px`,
            visibility: geometry() ? 'visible' : 'hidden',
          }}
        >
          <div
            id={props.id}
            ref={(element) => {
              setOverlayElement(element);
              updateGeometry();
              props.onOverlayRef?.(element);
              onCleanup(() => props.onOverlayRef?.(undefined));
            }}
            role={props.role}
            data-redeven-anchored-listbox=""
            data-placement={geometry()?.placement ?? 'bottom'}
            data-floating-presence={presence.state()}
            data-floating-side={geometry()?.placement ?? 'bottom'}
            inert={!props.open || !geometry()}
            aria-hidden={!props.open || !geometry() ? true : undefined}
            class={cn(
              'floe-floating-presence floe-floating-menu relative pointer-events-auto flex flex-col overflow-hidden rounded-panel border border-[var(--floe-line)] bg-popover text-popover-foreground shadow-[var(--floe-elevation-float)]',
              props.class,
            )}
            style={{
              'max-height': geometry() ? `${geometry()!.maxHeight}px` : `${props.maxHeight ?? DEFAULT_MAX_HEIGHT}px`,
            }}
          >
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  );
}
