import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
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

// IMPORTANT: Dialog form listboxes must live outside dialog scroll containers.
// A listbox anchored to a field is a floating surface, not form content; keeping
// this geometry in one component prevents footer/overflow clipping regressions.
export function resolveDesktopAnchoredListboxGeometry(options: Readonly<{
  anchorRect: DOMRect;
  overlayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  maxHeight?: number;
  minHeight?: number;
}>): DesktopAnchoredListboxGeometry {
  const maxHeight = Math.max(1, options.maxHeight ?? DEFAULT_MAX_HEIGHT);
  const minHeight = Math.max(1, Math.min(options.minHeight ?? DEFAULT_MIN_HEIGHT, maxHeight));
  const viewportWidth = Math.max(0, options.viewportWidth);
  const viewportHeight = Math.max(0, options.viewportHeight);
  const width = Math.max(1, Math.min(options.anchorRect.width, Math.max(1, viewportWidth - (LISTBOX_MARGIN * 2))));
  const left = clamp(options.anchorRect.left, LISTBOX_MARGIN, viewportWidth - width - LISTBOX_MARGIN);
  const availableBelow = Math.max(0, viewportHeight - options.anchorRect.bottom - LISTBOX_MARGIN - LISTBOX_GAP);
  const availableAbove = Math.max(0, options.anchorRect.top - LISTBOX_MARGIN - LISTBOX_GAP);
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
    top: clamp(rawTop, LISTBOX_MARGIN, viewportHeight - renderedHeight - LISTBOX_MARGIN),
    width,
    maxHeight: resolvedMaxHeight,
  };
}

export function DesktopAnchoredListbox(props: DesktopAnchoredListboxProps) {
  const [geometry, setGeometry] = createSignal<DesktopAnchoredListboxGeometry | null>(null);
  let frame = 0;
  let overlayRef: HTMLDivElement | undefined;

  const clearFrame = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updateGeometry = () => {
    if (!props.anchorRef || !overlayRef || typeof window === 'undefined') {
      return;
    }
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;
    const nextGeometry = resolveDesktopAnchoredListboxGeometry({
      anchorRect: props.anchorRef.getBoundingClientRect(),
      overlayHeight: overlayRef.getBoundingClientRect().height,
      viewportWidth,
      viewportHeight,
      maxHeight: props.maxHeight,
      minHeight: props.minHeight,
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
    if (!props.open) {
      clearFrame();
      setGeometry(null);
      return;
    }

    scheduleGeometryUpdate();

    const handleViewportChange = () => scheduleGeometryUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = props.anchorRef;
    const nextOverlayRef = overlayRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !nextOverlayRef
      ? null
      : new ResizeObserver(() => updateGeometry());
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
    props.onOverlayRef?.(undefined);
  });

  return (
    <Portal>
      <div
        id={props.id}
        ref={(element) => {
          overlayRef = element;
          props.onOverlayRef?.(element);
        }}
        role={props.role}
        data-redeven-anchored-listbox=""
        data-placement={geometry()?.placement ?? 'bottom'}
        class={cn(
          'fixed z-[240] flex flex-col overflow-hidden rounded-md border border-border bg-popover shadow-xl',
          props.class,
        )}
        style={{
          left: geometry() ? `${geometry()!.left}px` : '0px',
          top: geometry() ? `${geometry()!.top}px` : '0px',
          width: geometry() ? `${geometry()!.width}px` : props.anchorRef ? `${props.anchorRef.getBoundingClientRect().width}px` : '0px',
          'max-height': geometry() ? `${geometry()!.maxHeight}px` : `${props.maxHeight ?? DEFAULT_MAX_HEIGHT}px`,
          visibility: props.open && geometry() ? 'visible' : 'hidden',
        }}
      >
        {props.children}
      </div>
    </Portal>
  );
}
