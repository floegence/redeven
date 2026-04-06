import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor, type JSX } from 'solid-js';

import { normalizePath } from './FileBrowserShared';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

const FAB_SIZE = 44;
const EDGE_MARGIN = 12;

export type FileBrowserFABContainerRef = HTMLElement | undefined | (() => HTMLElement | undefined);
export type FileBrowserFABAnchorEdge = 'left' | 'right' | 'top' | 'bottom';
export type FileBrowserFABAnchorState = Readonly<{
  edge: FileBrowserFABAnchorEdge;
  offsetRatio: number;
}>;
export type FileBrowserFABLayoutRect = Readonly<{
  width: number;
  height: number;
}>;
export type FileBrowserFABPosition = Readonly<{
  left: number;
  top: number;
}>;

const DEFAULT_FAB_ANCHOR: FileBrowserFABAnchorState = {
  edge: 'right',
  offsetRatio: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return clamp(value, 0, 1);
}

function layoutSpan(length: number): number {
  return Math.max(0, length - FAB_SIZE - EDGE_MARGIN * 2);
}

function normalizeLayoutRect(layout: FileBrowserFABLayoutRect): FileBrowserFABLayoutRect {
  return {
    width: Math.max(0, Math.round(layout.width)),
    height: Math.max(0, Math.round(layout.height)),
  };
}

export function projectFileBrowserFABAnchor(
  anchor: FileBrowserFABAnchorState,
  layout: FileBrowserFABLayoutRect,
): FileBrowserFABPosition {
  const normalizedLayout = normalizeLayoutRect(layout);
  const leftEdge = EDGE_MARGIN;
  const topEdge = EDGE_MARGIN;
  const rightEdge = Math.max(EDGE_MARGIN, normalizedLayout.width - FAB_SIZE - EDGE_MARGIN);
  const bottomEdge = Math.max(EDGE_MARGIN, normalizedLayout.height - FAB_SIZE - EDGE_MARGIN);
  const horizontalSpan = layoutSpan(normalizedLayout.width);
  const verticalSpan = layoutSpan(normalizedLayout.height);
  const offsetRatio = clampRatio(anchor.offsetRatio);

  switch (anchor.edge) {
    case 'left':
      return {
        left: leftEdge,
        top: topEdge + verticalSpan * offsetRatio,
      };
    case 'top':
      return {
        left: leftEdge + horizontalSpan * offsetRatio,
        top: topEdge,
      };
    case 'bottom':
      return {
        left: leftEdge + horizontalSpan * offsetRatio,
        top: bottomEdge,
      };
    case 'right':
    default:
      return {
        left: rightEdge,
        top: topEdge + verticalSpan * offsetRatio,
      };
  }
}

export function resolveFileBrowserFABAnchorFromPosition(
  position: FileBrowserFABPosition,
  layout: FileBrowserFABLayoutRect,
): FileBrowserFABAnchorState {
  const normalizedLayout = normalizeLayoutRect(layout);
  const leftEdge = EDGE_MARGIN;
  const topEdge = EDGE_MARGIN;
  const rightEdge = Math.max(EDGE_MARGIN, normalizedLayout.width - FAB_SIZE - EDGE_MARGIN);
  const bottomEdge = Math.max(EDGE_MARGIN, normalizedLayout.height - FAB_SIZE - EDGE_MARGIN);
  const clampedLeft = clamp(position.left, leftEdge, rightEdge);
  const clampedTop = clamp(position.top, topEdge, bottomEdge);

  const dLeft = Math.abs(clampedLeft - leftEdge);
  const dRight = Math.abs(rightEdge - clampedLeft);
  const dTop = Math.abs(clampedTop - topEdge);
  const dBottom = Math.abs(bottomEdge - clampedTop);
  const minDist = Math.min(dLeft, dRight, dTop, dBottom);

  if (minDist === dLeft) {
    return {
      edge: 'left',
      offsetRatio: clampRatio((clampedTop - EDGE_MARGIN) / Math.max(1, layoutSpan(normalizedLayout.height))),
    };
  }
  if (minDist === dRight) {
    return {
      edge: 'right',
      offsetRatio: clampRatio((clampedTop - EDGE_MARGIN) / Math.max(1, layoutSpan(normalizedLayout.height))),
    };
  }
  if (minDist === dTop) {
    return {
      edge: 'top',
      offsetRatio: clampRatio((clampedLeft - EDGE_MARGIN) / Math.max(1, layoutSpan(normalizedLayout.width))),
    };
  }
  return {
    edge: 'bottom',
    offsetRatio: clampRatio((clampedLeft - EDGE_MARGIN) / Math.max(1, layoutSpan(normalizedLayout.width))),
  };
}

export function resolveFileBrowserFABContainerRef(
  containerRef: FileBrowserFABContainerRef,
): HTMLElement | undefined {
  return typeof containerRef === 'function' ? containerRef() : containerRef;
}

export function createFileBrowserFABModel(args: Readonly<{
  workingDir: Accessor<string>;
  homePath: Accessor<string | undefined>;
  containerRef: Accessor<HTMLElement | undefined>;
  allowHomeFallback?: boolean;
}>) {
  const fileBrowserSurface = useFileBrowserSurfaceContext();
  const [anchorState, setAnchorState] = createSignal<FileBrowserFABAnchorState>(DEFAULT_FAB_ANCHOR);
  const [dragPosition, setDragPosition] = createSignal<FileBrowserFABPosition | null>(null);
  const [containerLayout, setContainerLayout] = createSignal<FileBrowserFABLayoutRect | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isSnapping, setIsSnapping] = createSignal(false);
  let dragStart: { px: number; py: number; fabLeft: number; fabTop: number } | null = null;

  const resolvedSeedPath = createMemo(() => {
    const workingDir = normalizeAbsolutePath(args.workingDir());
    if (workingDir) return workingDir;
    if (!args.allowHomeFallback) return '';
    return normalizeAbsolutePath(args.homePath() ?? '');
  });

  const browserSeed = createMemo(() => {
    const path = resolvedSeedPath();
    if (!path) return null;
    const homePath = normalizeAbsolutePath(args.homePath() ?? '');
    return {
      path,
      homePath: homePath || undefined,
    };
  });

  const canOpenBrowser = createMemo(() => browserSeed() !== null);

  function syncContainerLayout(container: HTMLElement | undefined): FileBrowserFABLayoutRect | null {
    if (!container) {
      setContainerLayout(null);
      return null;
    }
    const nextLayout = normalizeLayoutRect({
      width: container.clientWidth,
      height: container.clientHeight,
    });
    setContainerLayout(nextLayout);
    return nextLayout;
  }

  function resolveActiveContainerLayout(): FileBrowserFABLayoutRect | null {
    const existing = containerLayout();
    if (existing) return existing;
    return syncContainerLayout(args.containerRef());
  }

  const projectedPosition = createMemo<FileBrowserFABPosition | null>(() => {
    const position = dragPosition();
    if (position) return position;
    const layout = containerLayout();
    if (!layout) return null;
    return projectFileBrowserFABAnchor(anchorState(), layout);
  });

  createEffect(() => {
    const container = args.containerRef();
    if (!container) {
      setContainerLayout(null);
      return;
    }

    const sync = () => {
      syncContainerLayout(container);
    };

    sync();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        sync();
      });
      observer.observe(container);
      onCleanup(() => observer.disconnect());
      return;
    }

    window.addEventListener('resize', sync);
    onCleanup(() => window.removeEventListener('resize', sync));
  });

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !canOpenBrowser()) return;

    const button = event.currentTarget as HTMLElement;
    button.setPointerCapture(event.pointerId);

    const layout = resolveActiveContainerLayout();
    const currentPosition = untrack(projectedPosition) ?? (layout ? projectFileBrowserFABAnchor(anchorState(), layout) : null);
    const currentLeft = currentPosition?.left ?? 0;
    const currentTop = currentPosition?.top ?? 0;

    dragStart = {
      px: event.clientX,
      py: event.clientY,
      fabLeft: currentLeft,
      fabTop: currentTop,
    };
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragStart) return;

    const dx = event.clientX - dragStart.px;
    const dy = event.clientY - dragStart.py;
    if (!isDragging() && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    setIsDragging(true);

    let newLeft = dragStart.fabLeft + dx;
    let newTop = dragStart.fabTop + dy;

    const layout = resolveActiveContainerLayout();
    if (layout) {
      newLeft = Math.max(0, Math.min(newLeft, layout.width - FAB_SIZE));
      newTop = Math.max(0, Math.min(newTop, layout.height - FAB_SIZE));
    }

    setDragPosition({
      left: newLeft,
      top: newTop,
    });
  }

  function onPointerUp() {
    if (!dragStart) return;

    const droppedPosition = dragPosition() ?? {
      left: dragStart.fabLeft,
      top: dragStart.fabTop,
    };
    const wasDrag = isDragging();
    dragStart = null;
    setIsDragging(false);

    if (wasDrag) {
      const layout = resolveActiveContainerLayout();
      if (layout) {
        setIsSnapping(true);
        setAnchorState(resolveFileBrowserFABAnchorFromPosition(droppedPosition, layout));
      }
      setDragPosition(null);
      requestAnimationFrame(() => {
        setTimeout(() => setIsSnapping(false), 250);
      });
      return;
    }

    setDragPosition(null);

    void (async () => {
      const browser = untrack(browserSeed);
      if (!browser) return;
      await fileBrowserSurface.openBrowser(browser);
    })();
  }

  const fabStyle = createMemo<JSX.CSSProperties>(() => {
    const position = projectedPosition();
    if (!position) {
      return {};
    }
    return {
      left: `${position.left}px`,
      top: `${position.top}px`,
      right: 'auto',
      bottom: 'auto',
      transition: isSnapping() ? 'left 0.25s ease-out, top 0.25s ease-out' : 'none',
    };
  });

  return {
    fileBrowserSurface,
    browserSeed,
    canOpenBrowser,
    fabStyle,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
