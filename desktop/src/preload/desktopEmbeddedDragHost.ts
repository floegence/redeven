/// <reference lib="dom" />

import { contextBridge } from 'electron';

import {
  normalizeDesktopEmbeddedDragRegionSnapshot,
  type DesktopEmbeddedDragRegionsBridge,
  type DesktopEmbeddedDragRegionSnapshot,
} from '../shared/desktopEmbeddedDragRegions';

type FrameRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  disconnect: () => void;
}>;

type CreateResizeObserver = (callback: ResizeObserverCallback) => ResizeObserverLike | null;

type ProjectedOverlayRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type DesktopEmbeddedDragHostState = {
  frame: HTMLIFrameElement | null;
  frameSource: string;
  overlayRoot: HTMLElement | null;
  currentSnapshot: DesktopEmbeddedDragRegionSnapshot | null;
  rafID: number;
  resizeObserver: ResizeObserverLike | null;
};

declare global {
  interface Window {
    redevenDesktopEmbeddedDragRegions?: DesktopEmbeddedDragRegionsBridge;
  }
}

const DESKTOP_EMBEDDED_DRAG_HOST_STYLE_ID = 'redeven-desktop-embedded-drag-host';
const DESKTOP_EMBEDDED_DRAG_OVERLAY_SELECTOR = '[data-redeven-desktop-embedded-drag-overlay="true"]';

function defaultCreateResizeObserver(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  return new ResizeObserver(callback);
}

function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric;
}

function normalizeFrameRect(
  frameRect: FrameRect,
): ProjectedOverlayRect | null {
  const width = normalizePositiveNumber(frameRect.width);
  const height = normalizePositiveNumber(frameRect.height);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    left: Number.isFinite(frameRect.left) ? frameRect.left : 0,
    top: Number.isFinite(frameRect.top) ? frameRect.top : 0,
    width,
    height,
  };
}

export function projectDesktopEmbeddedDragRegions(
  frameRect: FrameRect,
  snapshot: DesktopEmbeddedDragRegionSnapshot,
): ProjectedOverlayRect[] {
  const normalizedFrame = normalizeFrameRect(frameRect);
  if (!normalizedFrame) {
    return [];
  }

  const frameRight = normalizedFrame.left + normalizedFrame.width;
  const frameBottom = normalizedFrame.top + normalizedFrame.height;

  return snapshot.regions.flatMap((region) => {
    const left = normalizedFrame.left + region.x;
    const top = normalizedFrame.top + region.y;
    const right = Math.min(frameRight, left + region.width);
    const bottom = Math.min(frameBottom, top + region.height);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
      return [];
    }
    return [{
      left,
      top,
      width,
      height,
    }];
  });
}

function resolveDesktopEmbeddedAppFrame(doc: Document): HTMLIFrameElement | null {
  const frame = doc.getElementById('app_frame');
  return frame instanceof HTMLIFrameElement ? frame : null;
}

function findOverlayRoot(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(DESKTOP_EMBEDDED_DRAG_OVERLAY_SELECTOR);
}

function resolveFrameSource(frame: HTMLIFrameElement | null): string {
  return frame?.getAttribute('src')?.trim() ?? '';
}

function ensureOverlayRoot(
  doc: Document,
  state: DesktopEmbeddedDragHostState,
): HTMLElement | null {
  if (!doc.body) {
    return null;
  }

  if (state.overlayRoot?.isConnected) {
    return state.overlayRoot;
  }

  const existing = findOverlayRoot(doc);
  if (existing) {
    state.overlayRoot = existing;
    return existing;
  }

  const overlayRoot = doc.createElement('div');
  overlayRoot.setAttribute('data-redeven-desktop-embedded-drag-overlay', 'true');
  overlayRoot.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(overlayRoot);
  state.overlayRoot = overlayRoot;
  return overlayRoot;
}

function ensureHostStyle(doc: Document): void {
  if (!doc.head || doc.getElementById(DESKTOP_EMBEDDED_DRAG_HOST_STYLE_ID)) {
    return;
  }

  const style = doc.createElement('style');
  style.id = DESKTOP_EMBEDDED_DRAG_HOST_STYLE_ID;
  style.textContent = `
[data-redeven-desktop-embedded-drag-overlay='true'] {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

[data-redeven-desktop-embedded-drag-overlay='true'] > [data-redeven-desktop-embedded-drag-region='true'] {
  position: fixed;
  background: transparent;
  pointer-events: auto;
  app-region: drag;
  user-select: none;
}
`;
  doc.head.appendChild(style);
}

export interface DesktopEmbeddedDragHost {
  bridge: DesktopEmbeddedDragRegionsBridge;
  clear: () => void;
  dispose: () => void;
  refresh: () => void;
}

export function installDesktopEmbeddedDragHost(args: Readonly<{
  doc?: Document;
  currentWindow?: Window;
  createResizeObserver?: CreateResizeObserver;
}> = {}): DesktopEmbeddedDragHost {
  const doc = args.doc ?? document;
  const currentWindow = args.currentWindow ?? doc.defaultView ?? window;
  const createResizeObserver = args.createResizeObserver ?? defaultCreateResizeObserver;

  let disposed = false;
  const state: DesktopEmbeddedDragHostState = {
    frame: null,
    frameSource: '',
    overlayRoot: null,
    currentSnapshot: null,
    rafID: 0,
    resizeObserver: null,
  };

  const clearOverlay = () => {
    if (state.overlayRoot?.isConnected) {
      state.overlayRoot.replaceChildren();
      return;
    }
    const overlayRoot = findOverlayRoot(doc);
    if (overlayRoot) {
      state.overlayRoot = overlayRoot;
      overlayRoot.replaceChildren();
      return;
    }
    state.overlayRoot = null;
  };

  const clearCurrentSnapshot = () => {
    state.currentSnapshot = null;
    clearOverlay();
  };

  const reconnectFrameLoadListener = () => {
    if (!state.frame) {
      return;
    }

    state.frame.addEventListener('load', scheduleRefresh);
  };

  const renderOverlay = () => {
    if (disposed) {
      return;
    }

    if (!state.frame || !state.currentSnapshot) {
      clearOverlay();
      return;
    }

    const projected = projectDesktopEmbeddedDragRegions(
      state.frame.getBoundingClientRect(),
      state.currentSnapshot,
    );
    if (projected.length <= 0) {
      clearOverlay();
      return;
    }

    ensureHostStyle(doc);
    const overlayRoot = ensureOverlayRoot(doc, state);
    if (!overlayRoot) {
      return;
    }

    const fragments = projected.map((rect) => {
      const element = doc.createElement('div');
      element.setAttribute('data-redeven-desktop-embedded-drag-region', 'true');
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      return element;
    });
    overlayRoot.replaceChildren(...fragments);
  };

  const scheduleRefresh = () => {
    if (disposed || state.rafID !== 0) {
      return;
    }
    const requestFrame = currentWindow.requestAnimationFrame?.bind(currentWindow)
      ?? ((callback: FrameRequestCallback) => currentWindow.setTimeout(() => callback(Date.now()), 0));
    state.rafID = requestFrame(() => {
      state.rafID = 0;
      syncObservedFrame();
      renderOverlay();
    });
  };

  const syncObservedFrame = () => {
    const nextFrame = resolveDesktopEmbeddedAppFrame(doc);
    const nextFrameSource = resolveFrameSource(nextFrame);
    const frameChanged = state.frame !== nextFrame;
    const frameSourceChanged = state.frameSource !== nextFrameSource;

    if ((frameChanged || frameSourceChanged) && state.frame) {
      state.frame.removeEventListener('load', scheduleRefresh);
    }

    if (frameChanged || frameSourceChanged) {
      const hadTrackedFrame = state.frame !== null;
      state.frame = nextFrame;
      state.frameSource = nextFrameSource;
      state.resizeObserver?.disconnect();
      state.resizeObserver = null;
      if (hadTrackedFrame && state.currentSnapshot) {
        clearCurrentSnapshot();
      }
    }

    if (!state.frame) {
      return;
    }

    if (state.resizeObserver) {
      return;
    }

    state.resizeObserver = createResizeObserver(() => {
      scheduleRefresh();
    });
    if (!state.resizeObserver) {
      return;
    }

    state.resizeObserver.observe(state.frame);
    reconnectFrameLoadListener();
  };

  const bridge: DesktopEmbeddedDragRegionsBridge = {
    setSnapshot: (nextSnapshot) => {
      state.currentSnapshot = normalizeDesktopEmbeddedDragRegionSnapshot(nextSnapshot);
      scheduleRefresh();
    },
    clear: () => {
      clearCurrentSnapshot();
    },
  };

  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => {
      scheduleRefresh();
    });

  if (doc.documentElement) {
    mutationObserver?.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'id', 'src'],
      childList: true,
      subtree: true,
    });
  }

  currentWindow.addEventListener('resize', scheduleRefresh);
  currentWindow.addEventListener('load', scheduleRefresh);
  doc.addEventListener('readystatechange', scheduleRefresh);

  scheduleRefresh();

  return {
    bridge,
    clear: bridge.clear,
    refresh: () => {
      syncObservedFrame();
      renderOverlay();
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (state.rafID !== 0) {
        const cancelFrame = currentWindow.cancelAnimationFrame?.bind(currentWindow)
          ?? ((id: number) => currentWindow.clearTimeout(id));
        cancelFrame(state.rafID);
        state.rafID = 0;
      }
      state.frame?.removeEventListener('load', scheduleRefresh);
      mutationObserver?.disconnect();
      state.resizeObserver?.disconnect();
      currentWindow.removeEventListener('resize', scheduleRefresh);
      currentWindow.removeEventListener('load', scheduleRefresh);
      doc.removeEventListener('readystatechange', scheduleRefresh);
      bridge.clear();
      state.frame = null;
      state.frameSource = '';
      state.overlayRoot = null;
    },
  };
}

export function bootstrapDesktopEmbeddedDragHostBridge(): void {
  // Electron runs the same preload in every iframe. Only the top-level session
  // document may own native drag overlays; embedded renderers must publish to it.
  if ((process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame === false) {
    return;
  }
  const host = installDesktopEmbeddedDragHost();
  contextBridge.exposeInMainWorld('redevenDesktopEmbeddedDragRegions', host.bridge);
}
