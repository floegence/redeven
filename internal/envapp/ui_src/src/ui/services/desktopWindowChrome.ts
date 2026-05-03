import {
  buildDesktopWindowChromeStyleText,
  DESKTOP_WINDOW_CHROME_STYLE_ID,
  normalizeDesktopWindowChromeSnapshot,
  type DesktopWindowChromeSnapshot,
} from '../../../../../../desktop/src/shared/windowChromeContract';
import type { FloatingWindowViewportInsets } from '@floegence/floe-webapp-core/ui';
import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopWindowChromeBridge {
  getSnapshot: () => DesktopWindowChromeSnapshot;
  subscribe?: (listener: (snapshot: DesktopWindowChromeSnapshot) => void) => () => void;
}

export type DesktopFloatingWindowSafeArea = Readonly<Required<FloatingWindowViewportInsets>>;

declare global {
  interface Window {
    redevenDesktopWindowChrome?: DesktopWindowChromeBridge;
  }
}

const subscribedDocuments = new WeakSet<Document>();
const EMPTY_DESKTOP_FLOATING_WINDOW_SAFE_AREA: DesktopFloatingWindowSafeArea = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

function isDesktopWindowChromeBridge(candidate: unknown): candidate is DesktopWindowChromeBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopWindowChromeBridge>;
  return typeof bridge.getSnapshot === 'function';
}

export function desktopWindowChromeBridge(): DesktopWindowChromeBridge | null {
  return readDesktopHostBridge('redevenDesktopWindowChrome', isDesktopWindowChromeBridge);
}

export function readDesktopWindowChromeSnapshot(): DesktopWindowChromeSnapshot | null {
  const bridge = desktopWindowChromeBridge();
  if (!bridge) {
    return null;
  }
  try {
    return normalizeDesktopWindowChromeSnapshot(bridge.getSnapshot());
  } catch {
    return null;
  }
}

export function desktopFloatingWindowSafeAreaFromSnapshot(
  snapshot: DesktopWindowChromeSnapshot | null,
): DesktopFloatingWindowSafeArea {
  if (!snapshot) {
    return EMPTY_DESKTOP_FLOATING_WINDOW_SAFE_AREA;
  }
  return {
    top: snapshot.titleBarHeight,
    right: 0,
    bottom: 0,
    left: 0,
  };
}

export function sameDesktopFloatingWindowSafeArea(
  left: DesktopFloatingWindowSafeArea,
  right: DesktopFloatingWindowSafeArea,
): boolean {
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left;
}

export function readDesktopFloatingWindowSafeArea(): DesktopFloatingWindowSafeArea {
  if (typeof window === 'undefined') {
    return EMPTY_DESKTOP_FLOATING_WINDOW_SAFE_AREA;
  }
  return desktopFloatingWindowSafeAreaFromSnapshot(readDesktopWindowChromeSnapshot());
}

export function subscribeDesktopFloatingWindowSafeArea(
  listener: (safeArea: DesktopFloatingWindowSafeArea) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const bridge = desktopWindowChromeBridge();
  if (!bridge?.subscribe) {
    return () => undefined;
  }
  return bridge.subscribe((snapshot) => {
    listener(desktopFloatingWindowSafeAreaFromSnapshot(normalizeDesktopWindowChromeSnapshot(snapshot)));
  });
}

function applyDesktopWindowChromeSnapshotToDocument(
  snapshot: DesktopWindowChromeSnapshot,
  doc: Document,
): void {
  const root = doc.documentElement;
  if (!root) {
    return;
  }

  root.dataset.redevenDesktopWindowChromeMode = snapshot.mode;
  root.dataset.redevenDesktopWindowControlsSide = snapshot.controlsSide;

  if (!doc.head) {
    return;
  }
  let style = doc.getElementById(DESKTOP_WINDOW_CHROME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = DESKTOP_WINDOW_CHROME_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = buildDesktopWindowChromeStyleText(snapshot);
}

export function installDesktopWindowChromeDocumentSync(doc: Document = document): DesktopWindowChromeSnapshot | null {
  if (!doc || typeof window === 'undefined') {
    return null;
  }

  const bridge = desktopWindowChromeBridge();
  const snapshot = readDesktopWindowChromeSnapshot();
  if (!snapshot) {
    return null;
  }

  const applySnapshot = (nextSnapshot: DesktopWindowChromeSnapshot) => {
    applyDesktopWindowChromeSnapshotToDocument(nextSnapshot, doc);
  };

  applySnapshot(snapshot);
  if (!subscribedDocuments.has(doc)) {
    doc.addEventListener('readystatechange', () => {
      const nextSnapshot = readDesktopWindowChromeSnapshot();
      if (nextSnapshot) {
        applySnapshot(nextSnapshot);
      }
    });
    doc.defaultView?.addEventListener('DOMContentLoaded', () => {
      const nextSnapshot = readDesktopWindowChromeSnapshot();
      if (nextSnapshot) {
        applySnapshot(nextSnapshot);
      }
    }, { once: true });
    bridge?.subscribe?.((nextSnapshot) => {
      applyDesktopWindowChromeSnapshotToDocument(nextSnapshot, doc);
    });
    subscribedDocuments.add(doc);
  }
  return snapshot;
}
