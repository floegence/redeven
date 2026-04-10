import { createEffect, createMemo, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { FloatingWindow, type FloatingWindowProps } from '@floegence/floe-webapp-core/ui';
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

export interface PersistentFloatingWindowProps extends FloatingWindowProps {
  persistenceKey?: string;
  contentClass?: string;
  footerClass?: string;
  surfaceRef?: PersistentFloatingWindowSurfaceRef;
}

export function PersistentFloatingWindow(props: PersistentFloatingWindowProps): JSX.Element {
  const markerClass = `redeven-persistent-floating-window-${createUniqueId()}`;
  const persistenceKey = () => compact(props.persistenceKey);
  const persistedRect = createMemo(() => {
    const key = persistenceKey();
    if (!key) {
      return null;
    }
    return readPersistentRect(key);
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
      const root = findGeometryRootForMarker(markerClass);
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
      zIndex={props.zIndex}
    >
      {props.children}
    </FloatingWindow>
  );
}
