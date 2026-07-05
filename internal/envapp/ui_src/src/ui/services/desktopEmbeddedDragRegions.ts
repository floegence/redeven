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

type DesktopEmbeddedDragRegionRefreshKind = 'geometry' | 'membership';

type DesktopEmbeddedDragRegionRootMembership = Readonly<{
  root: HTMLElement;
  noDragElements: readonly HTMLElement[];
}>;

type DesktopEmbeddedDragRegionMembership = Readonly<{
  roots: readonly DesktopEmbeddedDragRegionRootMembership[];
  globalNoDragBlockers: readonly HTMLElement[];
  observedElements: readonly HTMLElement[];
  mutationAnchors: readonly HTMLElement[];
}>;

declare global {
  interface Window {
    redevenDesktopEmbeddedDragRegions?: DesktopEmbeddedDragRegionsBridge;
  }
}

const NO_DRAG_TARGET_SELECTOR = DESKTOP_WINDOW_CHROME_NO_DRAG_TARGET_SELECTORS.join(',');
const DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_SELECTOR = [
  DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS[0],
  DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS[1],
  DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR,
].join(',');
const DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_ATTRIBUTE_FILTER = [
  'style',
  'data-floe-shell-slot',
  'data-redeven-desktop-titlebar-drag-region',
  'data-redeven-desktop-titlebar-no-drag',
  'role',
] as const;
const DESKTOP_EMBEDDED_DRAG_REGION_MEMBERSHIP_MUTATION_ATTRIBUTES = new Set<string>([
  'data-floe-shell-slot',
  'data-redeven-desktop-titlebar-drag-region',
  'data-redeven-desktop-titlebar-no-drag',
  'role',
]);

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

function collectGlobalNoDragBlockerElements(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR));
}

function collectDragRegionMembership(doc: Document): DesktopEmbeddedDragRegionMembership {
  const roots = collectDragRootElements(doc);
  const observedElements = new Set<HTMLElement>(roots);
  const rootMemberships = roots.map((root): DesktopEmbeddedDragRegionRootMembership => {
    const noDragElements = Array.from(root.querySelectorAll<HTMLElement>(NO_DRAG_TARGET_SELECTOR));
    for (const element of noDragElements) {
      observedElements.add(element);
    }
    return { root, noDragElements };
  });
  const globalNoDragBlockers = collectGlobalNoDragBlockerElements(doc);
  for (const element of globalNoDragBlockers) {
    observedElements.add(element);
  }
  return {
    roots: rootMemberships,
    globalNoDragBlockers,
    observedElements: [...observedElements],
    mutationAnchors: [...new Set([...roots, ...globalNoDragBlockers])],
  };
}

function isCurrentDocumentElement(element: HTMLElement, doc: Document): boolean {
  return element.ownerDocument === doc && element.isConnected;
}

function rootStillMatchesDragRootSelector(root: HTMLElement): boolean {
  return DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS.some((selector) => root.matches(selector));
}

function cachedMembershipNeedsRefresh(
  membership: DesktopEmbeddedDragRegionMembership,
  doc: Document,
): boolean {
  for (const { root, noDragElements } of membership.roots) {
    if (!isCurrentDocumentElement(root, doc) || !rootStillMatchesDragRootSelector(root)) {
      return true;
    }
    for (const element of noDragElements) {
      if (
        !isCurrentDocumentElement(element, doc)
        || !root.contains(element)
        || !element.matches(NO_DRAG_TARGET_SELECTOR)
      ) {
        return true;
      }
    }
  }
  for (const element of membership.globalNoDragBlockers) {
    if (!isCurrentDocumentElement(element, doc) || !element.matches(DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR)) {
      return true;
    }
  }
  return false;
}

function collectNoDragRectsFromElements(
  elements: readonly HTMLElement[],
): DesktopEmbeddedDragRegionRect[] {
  return elements
    .map((element) => normalizeRect(element.getBoundingClientRect()))
    .filter((rect): rect is DesktopEmbeddedDragRegionRect => rect !== null);
}

function buildDesktopEmbeddedDragRegionSnapshotFromMembership(
  membership: DesktopEmbeddedDragRegionMembership,
): DesktopEmbeddedDragRegionSnapshot | null {
  const globalNoDragBlockerRectCache = new Map<HTMLElement, DesktopEmbeddedDragRegionRect | null>();
  const readGlobalNoDragBlockerRect = (element: HTMLElement): DesktopEmbeddedDragRegionRect | null => {
    if (!globalNoDragBlockerRectCache.has(element)) {
      globalNoDragBlockerRectCache.set(element, normalizeRect(element.getBoundingClientRect()));
    }
    return globalNoDragBlockerRectCache.get(element) ?? null;
  };

  const dragRects = membership.roots.flatMap(({ root, noDragElements }) => {
    const rootRect = normalizeRect(root.getBoundingClientRect());
    if (!rootRect) {
      return [];
    }
    let currentRects = [rootRect];
    const globalNoDragBlockerRects = membership.globalNoDragBlockers
      .filter((element) => element !== root && !root.contains(element) && !element.contains(root))
      .map(readGlobalNoDragBlockerRect)
      .filter((rect): rect is DesktopEmbeddedDragRegionRect => rect !== null);
    const exclusions = [
      ...collectNoDragRectsFromElements(noDragElements),
      ...globalNoDragBlockerRects,
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

function nodeTouchesDragRegionAnchor(
  node: Node,
  anchors: readonly HTMLElement[],
): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  if (node.matches(DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_SELECTOR)) {
    return true;
  }

  return anchors.some((anchor) => anchor.contains(node));
}

function mutationTouchesDragRegion(
  record: MutationRecord,
  anchors: readonly HTMLElement[],
): boolean {
  if (nodeTouchesDragRegionAnchor(record.target, anchors)) {
    return true;
  }

  if (record.type !== 'childList') {
    return false;
  }

  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (!(node instanceof Element)) {
      continue;
    }
    if (node.matches(DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_SELECTOR)) {
      return true;
    }
    if (node.querySelector(DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_SELECTOR)) {
      return true;
    }
  }

  return false;
}

function mutationDragRegionRefreshKind(
  record: MutationRecord,
  anchors: readonly HTMLElement[],
): DesktopEmbeddedDragRegionRefreshKind | null {
  if (record.type === 'attributes') {
    if (!nodeTouchesDragRegionAnchor(record.target, anchors)) {
      return null;
    }
    if (
      record.attributeName
      && DESKTOP_EMBEDDED_DRAG_REGION_MEMBERSHIP_MUTATION_ATTRIBUTES.has(record.attributeName)
    ) {
      return 'membership';
    }
    return record.attributeName === 'style' ? 'geometry' : null;
  }

  if (record.type === 'childList' && mutationTouchesDragRegion(record, anchors)) {
    return 'membership';
  }

  return null;
}

export function buildDesktopEmbeddedDragRegionSnapshot(
  doc: Document = document,
): DesktopEmbeddedDragRegionSnapshot | null {
  if (!doc) {
    return null;
  }

  return buildDesktopEmbeddedDragRegionSnapshotFromMembership(collectDragRegionMembership(doc));
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
  let scheduledRefreshKind: DesktopEmbeddedDragRegionRefreshKind | null = null;
  let membership: DesktopEmbeddedDragRegionMembership | null = null;
  let resizeObserver: ResizeObserverLike | null = null;
  let observedElements = new Set<HTMLElement>();
  let dragRegionMutationAnchors = new Set<HTMLElement>();
  let lastPublishedSnapshot: DesktopEmbeddedDragRegionSnapshot | null = null;

  const scheduleRefresh = (kind: DesktopEmbeddedDragRegionRefreshKind) => {
    if (disposed) {
      return;
    }
    if (scheduledRefreshKind !== 'membership') {
      scheduledRefreshKind = kind;
    }
    if (rafID !== 0) {
      return;
    }
    const requestFrame = currentWindow.requestAnimationFrame?.bind(currentWindow)
      ?? ((callback: FrameRequestCallback) => currentWindow.setTimeout(() => callback(Date.now()), 0));
    rafID = requestFrame(() => {
      const refreshKind = scheduledRefreshKind ?? 'membership';
      scheduledRefreshKind = null;
      rafID = 0;
      refreshScheduled(refreshKind);
    });
  };

  const scheduleGeometryRefresh = () => {
    scheduleRefresh('geometry');
  };

  const scheduleMembershipRefresh = () => {
    scheduleRefresh('membership');
  };

  const syncObservedElements = (nextObservedElements: readonly HTMLElement[]) => {
    const nextElements = new Set(nextObservedElements);
    if (!resizeObserver) {
      resizeObserver = createResizeObserver(() => {
        scheduleGeometryRefresh();
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
        scheduleGeometryRefresh();
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

  const refreshMembership = (): DesktopEmbeddedDragRegionSnapshot | null => {
    if (disposed) {
      return null;
    }
    membership = collectDragRegionMembership(doc);
    const snapshot = buildDesktopEmbeddedDragRegionSnapshotFromMembership(membership);
    publishSnapshot(snapshot);
    syncObservedElements(membership.observedElements);
    dragRegionMutationAnchors = new Set(membership.mutationAnchors);
    return snapshot;
  };

  const refreshScheduled = (kind: DesktopEmbeddedDragRegionRefreshKind): DesktopEmbeddedDragRegionSnapshot | null => {
    if (disposed) {
      return null;
    }
    if (kind === 'membership' || !membership || cachedMembershipNeedsRefresh(membership, doc)) {
      return refreshMembership();
    }
    const snapshot = buildDesktopEmbeddedDragRegionSnapshotFromMembership(membership);
    publishSnapshot(snapshot);
    return snapshot;
  };

  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver((records) => {
      let nextRefreshKind: DesktopEmbeddedDragRegionRefreshKind | null = null;
      const anchors = [...dragRegionMutationAnchors];
      for (const record of records) {
        const refreshKind = mutationDragRegionRefreshKind(record, anchors);
        if (refreshKind === 'membership') {
          nextRefreshKind = 'membership';
          break;
        }
        if (refreshKind === 'geometry') {
          nextRefreshKind = 'geometry';
        }
      }
      if (!nextRefreshKind) {
        return;
      }
      scheduleRefresh(nextRefreshKind);
    });

  const mutationObserverTarget = doc.body ?? doc.documentElement;
  mutationObserver?.observe(mutationObserverTarget ?? doc.documentElement, {
    attributes: true,
    attributeFilter: [...DESKTOP_EMBEDDED_DRAG_REGION_MUTATION_ATTRIBUTE_FILTER],
    childList: true,
    subtree: true,
  });

  currentWindow.addEventListener('resize', scheduleGeometryRefresh);
  doc.addEventListener('readystatechange', scheduleMembershipRefresh);
  currentWindow.addEventListener('load', scheduleMembershipRefresh);

  scheduleMembershipRefresh();

  return {
    refresh: refreshMembership,
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
      scheduledRefreshKind = null;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      membership = null;
      observedElements = new Set<HTMLElement>();
      dragRegionMutationAnchors = new Set<HTMLElement>();
      currentWindow.removeEventListener('resize', scheduleGeometryRefresh);
      doc.removeEventListener('readystatechange', scheduleMembershipRefresh);
      currentWindow.removeEventListener('load', scheduleMembershipRefresh);
      publishSnapshot(null);
    },
  };
}
