import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import {
  FloatingWindow,
  LOCAL_INTERACTION_SURFACE_ATTR,
  type FloatingWindowProps,
} from '@floegence/floe-webapp-core/ui';
import { DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR } from '../../../../../../desktop/src/shared/windowChromeContract';
import {
  readDesktopFloatingWindowSafeArea,
  sameDesktopFloatingWindowSafeArea,
  subscribeDesktopFloatingWindowSafeArea,
  type DesktopFloatingWindowSafeArea,
} from '../services/desktopWindowChrome';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';

type PersistentFloatingWindowRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const FLOATING_WINDOW_STORAGE_KEY_PREFIX = 'redeven:floating-window:';
const FLOATING_WINDOW_PERSIST_DELAY_MS = 150;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function floatingWindowStorageKey(key: string): string {
  return `${FLOATING_WINDOW_STORAGE_KEY_PREFIX}${compact(key)}`;
}

export function normalizePersistentFloatingWindowRect(value: unknown): PersistentFloatingWindowRect | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PersistentFloatingWindowRect>;
  if (
    !isFiniteNumber(candidate.x)
    || !isFiniteNumber(candidate.y)
    || !isFiniteNumber(candidate.width)
    || !isFiniteNumber(candidate.height)
  ) {
    return null;
  }

  const width = Math.round(candidate.width);
  const height = Math.round(candidate.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width,
    height,
  };
}

function readPersistentRect(key: string): PersistentFloatingWindowRect | null {
  const storageKey = floatingWindowStorageKey(key);
  return normalizePersistentFloatingWindowRect(readUIStorageJSON(storageKey, null));
}

function writePersistentRect(key: string, rect: PersistentFloatingWindowRect): void {
  writeUIStorageJSON(floatingWindowStorageKey(key), rect);
}

function readRectFromElement(element: HTMLElement | null): PersistentFloatingWindowRect | null {
  if (!element) {
    return null;
  }
  return normalizePersistentFloatingWindowRect(element.getBoundingClientRect());
}

function scheduleAfterFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

function applyClassTokens(element: HTMLElement | null, value: string): void {
  if (!element || !value) {
    return;
  }
  for (const token of value.split(/\s+/)) {
    if (token) {
      element.classList.add(token);
    }
  }
}

function findGeometryRootForMarker(markerClass: string): HTMLElement | null {
  const marker = document.querySelector(`.${markerClass}`) as HTMLElement | null;
  if (!marker) {
    return null;
  }
  if (marker.matches('[data-floe-geometry-surface="floating-window"]')) {
    return marker;
  }
  return marker.closest('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null ?? marker;
}

export type PersistentFloatingWindowSurfaceRef = (element: HTMLElement | null) => void;

type PersistentFloatingWindowDomBinding = Readonly<{
  geometryRoot: HTMLElement | null;
  interactionSurface: HTMLElement | null;
}>;

type FloatingWindowViewportInsets = NonNullable<FloatingWindowProps['viewportInsets']>;

function findInteractionSurfaceForMarker(markerClass: string): HTMLElement | null {
  const marker = document.querySelector(`.${markerClass}`);
  return marker instanceof HTMLElement ? marker : null;
}

function resolvePersistentFloatingWindowDomBinding(markerClass: string): PersistentFloatingWindowDomBinding {
  return {
    geometryRoot: findGeometryRootForMarker(markerClass),
    interactionSurface: findInteractionSurfaceForMarker(markerClass),
  };
}

function normalizeViewportInset(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function mergeFloatingWindowViewportInsets(
  desktopSafeArea: DesktopFloatingWindowSafeArea,
  appInsets: FloatingWindowProps['viewportInsets'],
): FloatingWindowViewportInsets {
  return {
    top: Math.max(desktopSafeArea.top, normalizeViewportInset(appInsets?.top)),
    right: Math.max(desktopSafeArea.right, normalizeViewportInset(appInsets?.right)),
    bottom: Math.max(desktopSafeArea.bottom, normalizeViewportInset(appInsets?.bottom)),
    left: Math.max(desktopSafeArea.left, normalizeViewportInset(appInsets?.left)),
  };
}

function applyFloatingWindowInputSurfaceContracts(binding: PersistentFloatingWindowDomBinding): void {
  for (const element of [binding.geometryRoot, binding.interactionSurface]) {
    element?.setAttribute(LOCAL_INTERACTION_SURFACE_ATTR, 'true');
    element?.setAttribute(DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR, 'true');
  }
}

export interface PersistentFloatingWindowProps extends FloatingWindowProps {
  persistenceKey?: string;
  contentClass?: string;
  footerClass?: string;
  surfaceRef?: PersistentFloatingWindowSurfaceRef;
}

export function PersistentFloatingWindow(props: PersistentFloatingWindowProps): JSX.Element {
  const markerClass = `redeven-persistent-floating-window-${createUniqueId()}`;
  const [desktopSafeArea, setDesktopSafeArea] = createSignal(readDesktopFloatingWindowSafeArea(), {
    equals: sameDesktopFloatingWindowSafeArea,
  });
  const floatingWindowViewportInsets = createMemo(() => (
    mergeFloatingWindowViewportInsets(desktopSafeArea(), props.viewportInsets)
  ));
  const persistenceKey = () => compact(props.persistenceKey);
  const persistedRect = createMemo(() => {
    const key = persistenceKey();
    if (!key) {
      return null;
    }
    return readPersistentRect(key);
  });

  createEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setDesktopSafeArea(readDesktopFloatingWindowSafeArea());
    const unsubscribe = subscribeDesktopFloatingWindowSafeArea(setDesktopSafeArea);
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    if (!props.open || typeof document === 'undefined') {
      return;
    }

    let disposed = false;
    let cancelBind: (() => void) | null = null;

    const bindSurfaceContract = () => {
      if (disposed) {
        return;
      }

      const binding = resolvePersistentFloatingWindowDomBinding(markerClass);
      if (!binding.geometryRoot || !binding.interactionSurface) {
        cancelBind = scheduleAfterFrame(bindSurfaceContract);
        return;
      }

      applyFloatingWindowInputSurfaceContracts(binding);
    };

    bindSurfaceContract();

    onCleanup(() => {
      disposed = true;
      cancelBind?.();
    });
  });

  createEffect(() => {
    const key = persistenceKey();
    if (!props.open || !key || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    let observer: MutationObserver | null = null;
    let cancelBind: (() => void) | null = null;
    let saveTimer: number | null = null;
    let disposed = false;

    const clearSaveTimer = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
    };

    const persistNow = () => {
      const rect = readRectFromElement(findGeometryRootForMarker(markerClass));
      if (!rect) {
        return;
      }
      writePersistentRect(key, rect);
    };

    const schedulePersist = () => {
      clearSaveTimer();
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        persistNow();
      }, FLOATING_WINDOW_PERSIST_DELAY_MS);
    };

    const bindObserver = () => {
      if (disposed) {
        return;
      }
      const root = findGeometryRootForMarker(markerClass);
      if (!root) {
        cancelBind = scheduleAfterFrame(bindObserver);
        return;
      }
      observer = new MutationObserver((records) => {
        if (records.some((record) => record.attributeName === 'style')) {
          schedulePersist();
        }
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['style'],
      });
      schedulePersist();
    };

    const handlePageHide = () => {
      clearSaveTimer();
      persistNow();
    };

    bindObserver();
    window.addEventListener('pagehide', handlePageHide);

    onCleanup(() => {
      disposed = true;
      cancelBind?.();
      clearSaveTimer();
      observer?.disconnect();
      window.removeEventListener('pagehide', handlePageHide);
      persistNow();
    });
  });

  createEffect(() => {
    const surfaceRef = props.surfaceRef;
    if (!surfaceRef || !props.open || typeof document === 'undefined') {
      surfaceRef?.(null);
      return;
    }

    let disposed = false;
    let cancelBind: (() => void) | null = null;

    const bindSurface = () => {
      if (disposed) {
        return;
      }
      const root = resolvePersistentFloatingWindowDomBinding(markerClass).geometryRoot;
      if (!root) {
        cancelBind = scheduleAfterFrame(bindSurface);
        return;
      }
      surfaceRef(root);
    };

    bindSurface();

    onCleanup(() => {
      disposed = true;
      cancelBind?.();
      surfaceRef(null);
    });
  });

  createEffect(() => {
    if (!props.open || typeof document === 'undefined') {
      return;
    }

    const contentClass = String(props.contentClass ?? '').trim();
    const footerClass = String(props.footerClass ?? '').trim();
    if (!contentClass && !footerClass) {
      return;
    }

    let disposed = false;
    let cancelBind: (() => void) | null = null;

    const bindSlotClasses = () => {
      if (disposed) {
        return;
      }

      const marker = document.querySelector(`.${markerClass}`) as HTMLElement | null;
      if (!marker) {
        cancelBind = scheduleAfterFrame(bindSlotClasses);
        return;
      }

      const children = Array.from(marker.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
      const contentEl = children[1] ?? null;
      const footerEl = children[2] ?? null;
      if (!contentEl || (footerClass && props.footer && !footerEl)) {
        cancelBind = scheduleAfterFrame(bindSlotClasses);
        return;
      }

      applyClassTokens(contentEl, contentClass);
      applyClassTokens(footerEl, footerClass);
    };

    bindSlotClasses();

    onCleanup(() => {
      disposed = true;
      cancelBind?.();
    });
  });

  return (
    <FloatingWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      footer={props.footer}
      defaultPosition={persistedRect() ? { x: persistedRect()!.x, y: persistedRect()!.y } : props.defaultPosition}
      defaultSize={persistedRect() ? { width: persistedRect()!.width, height: persistedRect()!.height } : props.defaultSize}
      minSize={props.minSize}
      maxSize={props.maxSize}
      resizable={props.resizable}
      draggable={props.draggable}
      class={cn(markerClass, props.class)}
      viewportInsets={floatingWindowViewportInsets()}
      zIndex={props.zIndex}
    >
      {props.children}
    </FloatingWindow>
  );
}
