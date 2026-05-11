import {
  type DesktopEmbeddedDragRegionRect,
  type DesktopEmbeddedDragRegionSnapshot,
  type DesktopEmbeddedDragRegionsBridge,
} from '../../../../../../desktop/src/shared/desktopEmbeddedDragRegions';
import {
  DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS,
  DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR,
  DESKTOP_WINDOW_CHROME_NO_DRAG_TARGET_SELECTORS,
} from '../../../../../../desktop/src/shared/windowChromeContract';
import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopEmbeddedDragRegionSync {
  refresh: () => DesktopEmbeddedDragRegionSnapshot | null;
  dispose: () => void;
}

type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  unobserve?: (target: Element) => void;
  disconnect: () => void;
}>;

type CreateResizeObserver = (callback: ResizeObserverCallback) => ResizeObserverLike | null;

declare global {
  interface Window {
    redevenDesktopEmbeddedDragRegions?: DesktopEmbeddedDragRegionsBridge;
  }
}

const NO_DRAG_TARGET_SELECTOR = DESKTOP_WINDOW_CHROME_NO_DRAG_TARGET_SELECTORS.join(',');
const DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_ATTRIBUTE_FILTER = [
  'style',
  'data-floe-shell-slot',
  'data-redeven-desktop-titlebar-drag-region',
  'data-redeven-desktop-titlebar-no-drag',
] as const;

function defaultCreateResizeObserver(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  return new ResizeObserver(callback);
}

function isDesktopEmbeddedDragRegionsBridge(candidate: unknown): candidate is DesktopEmbeddedDragRegionsBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopEmbeddedDragRegionsBridge>;
  return typeof bridge.setSnapshot === 'function' && typeof bridge.clear === 'function';
}

export function desktopEmbeddedDragRegionsBridge(currentWindow: Window = window): DesktopEmbeddedDragRegionsBridge | null {
  return readDesktopHostBridge(
    'redevenDesktopEmbeddedDragRegions',
    isDesktopEmbeddedDragRegionsBridge,
    currentWindow,
  );
}

function normalizePositiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeRect(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): DesktopEmbeddedDragRegionRect | null {
  const width = normalizePositiveNumber(rect.width);
  const height = normalizePositiveNumber(rect.height);
  if (width <= 0 || height <= 0) {
    return null;
  }
  const x = Number.isFinite(rect.x) ? rect.x : 0;
  const y = Number.isFinite(rect.y) ? rect.y : 0;
  return { x, y, width, height };
}

function rectRight(rect: Readonly<{ x: number; width: number }>): number {
  return rect.x + rect.width;
}

function rectBottom(rect: Readonly<{ y: number; height: number }>): number {
  return rect.y + rect.height;
}

function intersectRects(
  a: Readonly<{ x: number; y: number; width: number; height: number }>,
  b: Readonly<{ x: number; y: number; width: number; height: number }>,
): DesktopEmbeddedDragRegionRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  return normalizeRect({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

export function subtractDesktopEmbeddedDragRegionRect(
  source: DesktopEmbeddedDragRegionRect,
  exclusion: DesktopEmbeddedDragRegionRect,
): DesktopEmbeddedDragRegionRect[] {
  const overlap = intersectRects(source, exclusion);
  if (!overlap) {
    return [source];
  }

  const sourceRight = rectRight(source);
  const sourceBottom = rectBottom(source);
  const overlapRight = rectRight(overlap);
  const overlapBottom = rectBottom(overlap);
  const next: Array<DesktopEmbeddedDragRegionRect | null> = [
    normalizeRect({
      x: source.x,
      y: source.y,
      width: source.width,
      height: overlap.y - source.y,
    }),
    normalizeRect({
      x: source.x,
      y: overlapBottom,
      width: source.width,
      height: sourceBottom - overlapBottom,
    }),
    normalizeRect({
      x: source.x,
      y: overlap.y,
      width: overlap.x - source.x,
      height: overlap.height,
    }),
    normalizeRect({
      x: overlapRight,
      y: overlap.y,
      width: sourceRight - overlapRight,
      height: overlap.height,
    }),
  ];

  return next.filter((rect): rect is DesktopEmbeddedDragRegionRect => rect !== null);
}

function coalesceDesktopEmbeddedDragRegionRects(
  rects: readonly DesktopEmbeddedDragRegionRect[],
): DesktopEmbeddedDragRegionRect[] {
  if (rects.length <= 1) {
    return [...rects];
  }

  const sorted = [...rects].sort((a, b) => (
    a.y === b.y
      ? (a.height === b.height ? a.x - b.x : a.height - b.height)
      : a.y - b.y
  ));

  const merged: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.y === rect.y
      && previous.height === rect.height
      && rect.x <= rectRight(previous)
    ) {
      previous.width = Math.max(rectRight(previous), rectRight(rect)) - previous.x;
      continue;
    }
    merged.push({ ...rect });
  }
  return merged.map((rect) => ({ ...rect }));
}

function sameDesktopEmbeddedDragRegionRect(
  left: DesktopEmbeddedDragRegionRect,
  right: DesktopEmbeddedDragRegionRect,
): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function sameDesktopEmbeddedDragRegionSnapshot(
  left: DesktopEmbeddedDragRegionSnapshot | null,
  right: DesktopEmbeddedDragRegionSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.version !== right.version || left.regions.length !== right.regions.length) {
    return false;
  }
  return left.regions.every((rect, index) => sameDesktopEmbeddedDragRegionRect(rect, right.regions[index]));
}

function cloneDesktopEmbeddedDragRegionSnapshot(
  snapshot: DesktopEmbeddedDragRegionSnapshot,
): DesktopEmbeddedDragRegionSnapshot {
  return {
    version: snapshot.version,
    regions: snapshot.regions.map((rect) => ({ ...rect })),
  };
}

function rootContainsOtherDragRoot(
  dragRoot: Element,
  topBarRoots: readonly Element[],
): boolean {
  return topBarRoots.some((root) => root !== dragRoot && root.contains(dragRoot));
}

function collectDragRootElements(doc: Document): HTMLElement[] {
  const topBarRoots = Array.from(doc.querySelectorAll<HTMLElement>(DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS[0]));
  const explicitDragRoots = Array.from(doc.querySelectorAll<HTMLElement>(DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS[1]))
    .filter((root) => !rootContainsOtherDragRoot(root, topBarRoots));

  return [...new Set([...topBarRoots, ...explicitDragRoots])];
}

function collectNoDragRects(root: HTMLElement): DesktopEmbeddedDragRegionRect[] {
  return Array.from(root.querySelectorAll<HTMLElement>(NO_DRAG_TARGET_SELECTOR))
    .map((element) => normalizeRect(element.getBoundingClientRect()))
    .filter((rect): rect is DesktopEmbeddedDragRegionRect => rect !== null);
}

function collectGlobalNoDragBlockerElements(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR));
}

function collectGlobalNoDragBlockerRects(
  doc: Document,
  root: HTMLElement,
): DesktopEmbeddedDragRegionRect[] {
  return collectGlobalNoDragBlockerElements(doc)
    .filter((element) => element !== root && !root.contains(element) && !element.contains(root))
    .map((element) => normalizeRect(element.getBoundingClientRect()))
    .filter((rect): rect is DesktopEmbeddedDragRegionRect => rect !== null);
}

function collectObservedElements(doc: Document): HTMLElement[] {
  const roots = collectDragRootElements(doc);
  const observed = new Set<HTMLElement>(roots);
  for (const root of roots) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(NO_DRAG_TARGET_SELECTOR))) {
      observed.add(element);
    }
  }
  for (const element of collectGlobalNoDragBlockerElements(doc)) {
    observed.add(element);
  }
  return [...observed];
}

export function buildDesktopEmbeddedDragRegionSnapshot(
  doc: Document = document,
): DesktopEmbeddedDragRegionSnapshot | null {
  if (!doc) {
    return null;
  }

  const dragRects = collectDragRootElements(doc).flatMap((root) => {
    const rootRect = normalizeRect(root.getBoundingClientRect());
    if (!rootRect) {
      return [];
    }
    let currentRects = [rootRect];
    const exclusions = [
      ...collectNoDragRects(root),
      ...collectGlobalNoDragBlockerRects(doc, root),
    ];
    for (const exclusion of exclusions) {
      currentRects = currentRects.flatMap((rect) => subtractDesktopEmbeddedDragRegionRect(rect, exclusion));
      if (currentRects.length === 0) {
        return [];
      }
    }
    return coalesceDesktopEmbeddedDragRegionRects(currentRects);
  });

  if (dragRects.length === 0) {
    return null;
  }

  return {
    version: 1,
    regions: dragRects,
  };
}

export function installDesktopEmbeddedDragRegionSync(args: Readonly<{
  doc?: Document;
  currentWindow?: Window;
  createResizeObserver?: CreateResizeObserver;
}> = {}): DesktopEmbeddedDragRegionSync | null {
  const doc = args.doc ?? document;
  const currentWindow = args.currentWindow ?? doc.defaultView ?? window;
  const bridge = desktopEmbeddedDragRegionsBridge(currentWindow);
  if (!doc || !currentWindow || !bridge) {
    return null;
  }

  const createResizeObserver = args.createResizeObserver ?? defaultCreateResizeObserver;
  let disposed = false;
  let rafID = 0;
  let resizeObserver: ResizeObserverLike | null = null;
  let observedElements = new Set<HTMLElement>();
  let lastPublishedSnapshot: DesktopEmbeddedDragRegionSnapshot | null = null;

  const scheduleRefresh = () => {
    if (disposed || rafID !== 0) {
      return;
    }
    const requestFrame = currentWindow.requestAnimationFrame?.bind(currentWindow)
      ?? ((callback: FrameRequestCallback) => currentWindow.setTimeout(() => callback(Date.now()), 0));
    rafID = requestFrame(() => {
      rafID = 0;
      refresh();
    });
  };

  const syncObservedElements = () => {
    const nextElements = new Set(collectObservedElements(doc));
    if (!resizeObserver) {
      resizeObserver = createResizeObserver(() => {
        scheduleRefresh();
      });
    }
    if (!resizeObserver) {
      observedElements = nextElements;
      return;
    }

    let needsFullReconnect = false;
    for (const element of observedElements) {
      if (nextElements.has(element)) {
        continue;
      }
      if (resizeObserver.unobserve) {
        resizeObserver.unobserve(element);
      } else {
        needsFullReconnect = true;
        break;
      }
    }

    if (needsFullReconnect) {
      resizeObserver.disconnect();
      resizeObserver = createResizeObserver(() => {
        scheduleRefresh();
      });
      observedElements = new Set<HTMLElement>();
      if (!resizeObserver) {
        observedElements = nextElements;
        return;
      }
    }

    for (const element of nextElements) {
      if (!observedElements.has(element)) {
        resizeObserver.observe(element);
      }
    }
    observedElements = nextElements;
  };

  const publishSnapshot = (snapshot: DesktopEmbeddedDragRegionSnapshot | null) => {
    if (sameDesktopEmbeddedDragRegionSnapshot(lastPublishedSnapshot, snapshot)) {
      return;
    }
    if (!snapshot) {
      bridge.clear();
      lastPublishedSnapshot = null;
      return;
    }
    bridge.setSnapshot(snapshot);
    lastPublishedSnapshot = cloneDesktopEmbeddedDragRegionSnapshot(snapshot);
  };

  const refresh = (): DesktopEmbeddedDragRegionSnapshot | null => {
    if (disposed) {
      return null;
    }
    const snapshot = buildDesktopEmbeddedDragRegionSnapshot(doc);
    if (!snapshot) {
      publishSnapshot(null);
      syncObservedElements();
      return null;
    }
    publishSnapshot(snapshot);
    syncObservedElements();
    return snapshot;
  };

  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => {
      scheduleRefresh();
    });

  mutationObserver?.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: [...DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_ATTRIBUTE_FILTER],
    childList: true,
    subtree: true,
  });

  currentWindow.addEventListener('resize', scheduleRefresh);
  doc.addEventListener('readystatechange', scheduleRefresh);
  currentWindow.addEventListener('load', scheduleRefresh);

  scheduleRefresh();

  return {
    refresh,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (rafID !== 0) {
        const cancelFrame = currentWindow.cancelAnimationFrame?.bind(currentWindow)
          ?? ((id: number) => currentWindow.clearTimeout(id));
        cancelFrame(rafID);
        rafID = 0;
      }
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedElements = new Set<HTMLElement>();
      currentWindow.removeEventListener('resize', scheduleRefresh);
      doc.removeEventListener('readystatechange', scheduleRefresh);
      currentWindow.removeEventListener('load', scheduleRefresh);
      publishSnapshot(null);
    },
  };
}
