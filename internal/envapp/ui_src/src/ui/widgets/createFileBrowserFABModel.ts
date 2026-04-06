import { createMemo, createSignal, untrack, type Accessor, type JSX } from 'solid-js';

import { normalizePath } from './FileBrowserShared';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

const FAB_SIZE = 44;
const EDGE_MARGIN = 12;

export function createFileBrowserFABModel(args: Readonly<{
  workingDir: Accessor<string>;
  homePath: Accessor<string | undefined>;
  containerRef: Accessor<HTMLElement | undefined>;
  allowHomeFallback?: boolean;
}>) {
  const fileBrowserSurface = useFileBrowserSurfaceContext();
  const [fabLeft, setFabLeft] = createSignal<number | null>(null);
  const [fabTop, setFabTop] = createSignal<number | null>(null);
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

  function snapToEdge(left: number, top: number) {
    const container = args.containerRef();
    if (!container) {
      setFabLeft(left);
      setFabTop(top);
      return;
    }

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const clampedLeft = Math.max(EDGE_MARGIN, Math.min(left, cw - FAB_SIZE - EDGE_MARGIN));
    const clampedTop = Math.max(EDGE_MARGIN, Math.min(top, ch - FAB_SIZE - EDGE_MARGIN));

    const dLeft = clampedLeft;
    const dRight = cw - FAB_SIZE - clampedLeft;
    const dTop = clampedTop;
    const dBottom = ch - FAB_SIZE - clampedTop;
    const minDist = Math.min(dLeft, dRight, dTop, dBottom);

    let snapLeft = clampedLeft;
    let snapTop = clampedTop;
    if (minDist === dLeft) {
      snapLeft = EDGE_MARGIN;
    } else if (minDist === dRight) {
      snapLeft = cw - FAB_SIZE - EDGE_MARGIN;
    } else if (minDist === dTop) {
      snapTop = EDGE_MARGIN;
    } else {
      snapTop = ch - FAB_SIZE - EDGE_MARGIN;
    }

    setIsSnapping(true);
    setFabLeft(snapLeft);
    setFabTop(snapTop);
    requestAnimationFrame(() => {
      setTimeout(() => setIsSnapping(false), 250);
    });
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !canOpenBrowser()) return;

    const button = event.currentTarget as HTMLElement;
    button.setPointerCapture(event.pointerId);

    let currentLeft = fabLeft();
    let currentTop = fabTop();
    if (currentLeft == null || currentTop == null) {
      const container = args.containerRef();
      if (container) {
        currentLeft = container.clientWidth - FAB_SIZE - EDGE_MARGIN;
        currentTop = container.clientHeight - FAB_SIZE - EDGE_MARGIN;
      } else {
        currentLeft = 0;
        currentTop = 0;
      }
      setFabLeft(currentLeft);
      setFabTop(currentTop);
    }

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

    const container = args.containerRef();
    if (container) {
      newLeft = Math.max(0, Math.min(newLeft, container.clientWidth - FAB_SIZE));
      newTop = Math.max(0, Math.min(newTop, container.clientHeight - FAB_SIZE));
    }

    setFabLeft(newLeft);
    setFabTop(newTop);
  }

  function onPointerUp() {
    if (!dragStart) return;

    const wasDrag = isDragging();
    dragStart = null;
    setIsDragging(false);

    if (wasDrag) {
      snapToEdge(fabLeft()!, fabTop()!);
      return;
    }

    void (async () => {
      const browser = untrack(browserSeed);
      if (!browser) return;
      await fileBrowserSurface.openBrowser(browser);
    })();
  }

  const fabStyle = createMemo<JSX.CSSProperties>(() => {
    const left = fabLeft();
    const top = fabTop();
    if (left == null || top == null) {
      return {};
    }
    return {
      left: `${left}px`,
      top: `${top}px`,
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
