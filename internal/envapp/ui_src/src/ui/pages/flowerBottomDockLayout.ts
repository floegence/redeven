export const FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR = '--flower-chat-transcript-overlay-bottom-inset';
export const FLOWER_BOTTOM_DOCK_CLEARANCE_PX = 12;

type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  disconnect: () => void;
  unobserve?: (target: Element) => void;
}>;

type ResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserverLike | null;

export type FlowerBottomDockLayoutMetrics = Readonly<{
  dockHeightPx: number;
  clearancePx: number;
  transcriptOverlayInsetPx: number;
}>;

export type FlowerBottomDockLayoutController = Readonly<{
  setTranscriptElement: (element: HTMLElement | null | undefined) => void;
  setDockElement: (element: HTMLElement | null | undefined) => void;
  metrics: () => FlowerBottomDockLayoutMetrics;
  sync: () => FlowerBottomDockLayoutMetrics;
  dispose: () => void;
}>;

export interface CreateFlowerBottomDockLayoutControllerArgs {
  clearancePx?: number;
  cssVariableName?: string;
  createResizeObserver?: ResizeObserverFactory;
}

function defaultResizeObserverFactory(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') return null;
  return new ResizeObserver(callback);
}

function normalizePixelValue(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.ceil(numeric));
}

export function resolveFlowerBottomDockLayoutMetrics(args: Readonly<{
  dockHeightPx?: number;
  clearancePx?: number;
}>): FlowerBottomDockLayoutMetrics {
  const dockHeightPx = normalizePixelValue(args.dockHeightPx);
  const clearancePx = normalizePixelValue(args.clearancePx ?? FLOWER_BOTTOM_DOCK_CLEARANCE_PX);
  return {
    dockHeightPx,
    clearancePx,
    transcriptOverlayInsetPx: dockHeightPx > 0 ? dockHeightPx + clearancePx : 0,
  };
}

export function createFlowerBottomDockLayoutController(
  args: CreateFlowerBottomDockLayoutControllerArgs = {},
): FlowerBottomDockLayoutController {
  const cssVariableName = String(args.cssVariableName ?? FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR).trim()
    || FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR;
  const createResizeObserver = args.createResizeObserver ?? defaultResizeObserverFactory;

  let transcriptEl: HTMLElement | null = null;
  let dockEl: HTMLElement | null = null;
  let currentMetrics = resolveFlowerBottomDockLayoutMetrics({
    dockHeightPx: 0,
    clearancePx: args.clearancePx,
  });

  const clearTranscriptInset = (): void => {
    transcriptEl?.style.removeProperty(cssVariableName);
  };

  const measureDockHeight = (): number => {
    if (!dockEl) return 0;
    return normalizePixelValue(dockEl.getBoundingClientRect().height);
  };

  const applyMetrics = (): void => {
    if (!transcriptEl) return;
    if (currentMetrics.transcriptOverlayInsetPx <= 0) {
      clearTranscriptInset();
      return;
    }
    transcriptEl.style.setProperty(cssVariableName, `${currentMetrics.transcriptOverlayInsetPx}px`);
  };

  const sync = (): FlowerBottomDockLayoutMetrics => {
    currentMetrics = resolveFlowerBottomDockLayoutMetrics({
      dockHeightPx: measureDockHeight(),
      clearancePx: args.clearancePx,
    });
    applyMetrics();
    return currentMetrics;
  };

  const resizeObserver = createResizeObserver(() => {
    sync();
  });

  const observeDock = (): void => {
    resizeObserver?.disconnect();
    if (!dockEl) return;
    resizeObserver?.observe(dockEl);
  };

  const setTranscriptElement = (element: HTMLElement | null | undefined): void => {
    if (transcriptEl === (element ?? null)) return;
    clearTranscriptInset();
    transcriptEl = element ?? null;
    applyMetrics();
  };

  const setDockElement = (element: HTMLElement | null | undefined): void => {
    if (dockEl === (element ?? null)) return;
    dockEl = element ?? null;
    observeDock();
    sync();
  };

  const dispose = (): void => {
    resizeObserver?.disconnect();
    clearTranscriptInset();
    transcriptEl = null;
    dockEl = null;
    currentMetrics = resolveFlowerBottomDockLayoutMetrics({
      dockHeightPx: 0,
      clearancePx: args.clearancePx,
    });
  };

  return {
    setTranscriptElement,
    setDockElement,
    metrics: () => currentMetrics,
    sync,
    dispose,
  };
}
