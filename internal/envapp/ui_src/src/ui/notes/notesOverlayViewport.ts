type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  disconnect: () => void;
  unobserve?: (target: Element) => void;
}>;

type ResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserverLike | null;

type NotesOverlayViewportSourceRect = Partial<Pick<DOMRectReadOnly, 'top' | 'left' | 'right' | 'bottom' | 'width' | 'height'>>;

export const NOTES_OVERLAY_VIEWPORT_ATTR = 'data-redeven-notes-overlay-viewport';
export const NOTES_OVERLAY_VIEWPORT_ATTR_VALUE = 'active';
export const NOTES_OVERLAY_VIEWPORT_CSS_VARS = {
  top: '--redeven-notes-overlay-viewport-top',
  left: '--redeven-notes-overlay-viewport-left',
  right: '--redeven-notes-overlay-viewport-right',
  bottom: '--redeven-notes-overlay-viewport-bottom',
  width: '--redeven-notes-overlay-viewport-width',
  height: '--redeven-notes-overlay-viewport-height',
} as const;

export type NotesOverlayViewportRect = Readonly<{
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

type NotesOverlayViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type NotesOverlayViewportController = Readonly<{
  setViewportHostElements: (elements: readonly (HTMLElement | null | undefined)[] | null | undefined) => void;
  setActive: (active: boolean) => void;
  rect: () => NotesOverlayViewportRect;
  sync: () => NotesOverlayViewportRect;
  dispose: () => void;
}>;

export interface CreateNotesOverlayViewportControllerArgs {
  target?: HTMLElement | null;
  createResizeObserver?: ResizeObserverFactory;
  getViewportSize?: () => NotesOverlayViewportSize;
}

function defaultResizeObserverFactory(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') return null;
  return new ResizeObserver(callback);
}

function normalizeViewportPixelValue(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function clampBoundary(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, max));
}

function createEmptyRect(): NotesOverlayViewportRect {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  };
}

function resolveTarget(target?: HTMLElement | null): HTMLElement | null {
  if (target) return target;
  if (typeof document === 'undefined') return null;
  return document.body ?? null;
}

function defaultViewportSize(): NotesOverlayViewportSize {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }
  return {
    width: normalizeViewportPixelValue(window.innerWidth),
    height: normalizeViewportPixelValue(window.innerHeight),
  };
}

export function resolveNotesOverlayViewportRect(args: Readonly<{
  hostRect?: NotesOverlayViewportSourceRect | null;
  hostRects?: readonly (NotesOverlayViewportSourceRect | null | undefined)[] | null;
  viewportWidth?: number;
  viewportHeight?: number;
}>): NotesOverlayViewportRect {
  const viewportWidth = normalizeViewportPixelValue(args.viewportWidth);
  const viewportHeight = normalizeViewportPixelValue(args.viewportHeight);
  const hostRect = resolveUnionHostRect(args.hostRects ?? (args.hostRect ? [args.hostRect] : []));

  if (!hostRect || viewportWidth <= 0 || viewportHeight <= 0) {
    return createEmptyRect();
  }

  const leftBoundary = clampBoundary(normalizeViewportPixelValue(hostRect.left), viewportWidth);
  const topBoundary = clampBoundary(normalizeViewportPixelValue(hostRect.top), viewportHeight);
  const rawRightBoundary = Number.isFinite(hostRect.right)
    ? normalizeViewportPixelValue(hostRect.right)
    : normalizeViewportPixelValue(leftBoundary + normalizeViewportPixelValue(hostRect.width));
  const rawBottomBoundary = Number.isFinite(hostRect.bottom)
    ? normalizeViewportPixelValue(hostRect.bottom)
    : normalizeViewportPixelValue(topBoundary + normalizeViewportPixelValue(hostRect.height));
  const rightBoundary = clampBoundary(rawRightBoundary, viewportWidth);
  const bottomBoundary = clampBoundary(rawBottomBoundary, viewportHeight);

  return {
    top: topBoundary,
    left: leftBoundary,
    right: Math.max(0, viewportWidth - rightBoundary),
    bottom: Math.max(0, viewportHeight - bottomBoundary),
    width: Math.max(0, rightBoundary - leftBoundary),
    height: Math.max(0, bottomBoundary - topBoundary),
  };
}

function normalizeBoundaryValue(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function resolveRectEdgePair(
  rect: NotesOverlayViewportSourceRect,
  startKey: 'top' | 'left',
  endKey: 'bottom' | 'right',
  sizeKey: 'height' | 'width',
): Readonly<{ start: number; end: number }> | null {
  const start = normalizeBoundaryValue(rect[startKey]);
  if (start === null) return null;

  const explicitEnd = normalizeBoundaryValue(rect[endKey]);
  if (explicitEnd !== null) {
    return { start, end: explicitEnd };
  }

  const size = normalizeBoundaryValue(rect[sizeKey]);
  if (size === null) return null;
  return { start, end: start + size };
}

function resolveUnionHostRect(
  hostRects: readonly (NotesOverlayViewportSourceRect | null | undefined)[],
): NotesOverlayViewportSourceRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let found = false;

  for (const hostRect of hostRects) {
    if (!hostRect) continue;
    const horizontal = resolveRectEdgePair(hostRect, 'left', 'right', 'width');
    const vertical = resolveRectEdgePair(hostRect, 'top', 'bottom', 'height');
    if (!horizontal || !vertical) continue;

    found = true;
    left = Math.min(left, horizontal.start);
    top = Math.min(top, vertical.start);
    right = Math.max(right, horizontal.end);
    bottom = Math.max(bottom, vertical.end);
  }

  if (!found) return null;
  return {
    top,
    left,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function normalizeViewportHostElements(
  elements: readonly (HTMLElement | null | undefined)[] | null | undefined,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const element of elements ?? []) {
    if (!(element instanceof HTMLElement)) continue;
    if (seen.has(element)) continue;
    seen.add(element);
    out.push(element);
  }

  return out;
}

function sameViewportHostElements(a: readonly HTMLElement[], b: readonly HTMLElement[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function createNotesOverlayViewportController(
  args: CreateNotesOverlayViewportControllerArgs = {},
): NotesOverlayViewportController {
  const createResizeObserver = args.createResizeObserver ?? defaultResizeObserverFactory;
  const getViewportSize = args.getViewportSize ?? defaultViewportSize;

  let viewportHostElements: HTMLElement[] = [];
  let active = false;
  let currentRect = createEmptyRect();
  let removeWindowListeners: (() => void) | null = null;
  const resizeObserver = createResizeObserver(() => {
    sync();
  });

  const clearContract = (): void => {
    const target = resolveTarget(args.target);
    if (!target) return;

    target.removeAttribute(NOTES_OVERLAY_VIEWPORT_ATTR);
    for (const cssVarName of Object.values(NOTES_OVERLAY_VIEWPORT_CSS_VARS)) {
      target.style.removeProperty(cssVarName);
    }
  };

  const applyContract = (): void => {
    const target = resolveTarget(args.target);
    if (!target || !active || viewportHostElements.length === 0 || currentRect.width <= 0 || currentRect.height <= 0) {
      clearContract();
      return;
    }

    target.setAttribute(NOTES_OVERLAY_VIEWPORT_ATTR, NOTES_OVERLAY_VIEWPORT_ATTR_VALUE);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.top, `${currentRect.top}px`);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.left, `${currentRect.left}px`);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.right, `${currentRect.right}px`);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.bottom, `${currentRect.bottom}px`);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width, `${currentRect.width}px`);
    target.style.setProperty(NOTES_OVERLAY_VIEWPORT_CSS_VARS.height, `${currentRect.height}px`);
  };

  const disconnectViewportEvents = (): void => {
    removeWindowListeners?.();
    removeWindowListeners = null;
  };

  const sync = (): NotesOverlayViewportRect => {
    const viewportSize = getViewportSize();
    currentRect = resolveNotesOverlayViewportRect({
      hostRects: viewportHostElements.map((element) => element.getBoundingClientRect()),
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
    });
    applyContract();
    return currentRect;
  };

  const observeViewportHosts = (): void => {
    resizeObserver?.disconnect();
    if (!active || viewportHostElements.length === 0) return;
    for (const element of viewportHostElements) {
      resizeObserver?.observe(element);
    }
  };

  const connectViewportEvents = (): void => {
    disconnectViewportEvents();
    if (!active || typeof window === 'undefined') return;

    const handleViewportChange = () => {
      sync();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('scroll', handleViewportChange);

    removeWindowListeners = () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      visualViewport?.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  };

  const refreshBindings = (): void => {
    observeViewportHosts();
    connectViewportEvents();
    if (active) {
      sync();
      return;
    }
    clearContract();
  };

  const setViewportHostElements = (elements: readonly (HTMLElement | null | undefined)[] | null | undefined): void => {
    const nextElements = normalizeViewportHostElements(elements);
    if (sameViewportHostElements(viewportHostElements, nextElements)) return;
    viewportHostElements = nextElements;
    refreshBindings();
  };

  const setActive = (nextActive: boolean): void => {
    if (active === nextActive) return;
    active = nextActive;
    refreshBindings();
  };

  const dispose = (): void => {
    disconnectViewportEvents();
    resizeObserver?.disconnect();
    clearContract();
    viewportHostElements = [];
    active = false;
    currentRect = createEmptyRect();
  };

  return {
    setViewportHostElements,
    setActive,
    rect: () => currentRect,
    sync,
    dispose,
  };
}
