import {
  buildDesktopWindowChromeStyleText,
  DESKTOP_WINDOW_CHROME_STYLE_ID,
  normalizeDesktopWindowChromeSnapshot,
  type DesktopWindowChromeSnapshot,
} from '../../../../../../desktop/src/shared/windowChromeContract';
import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopWindowChromeBridge {
  getSnapshot: () => DesktopWindowChromeSnapshot;
}

declare global {
  interface Window {
    redevenDesktopWindowChrome?: DesktopWindowChromeBridge;
  }
}

const subscribedDocuments = new WeakSet<Document>();

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

  const snapshot = readDesktopWindowChromeSnapshot();
  if (!snapshot) {
    return null;
  }

  const applySnapshot = () => {
    applyDesktopWindowChromeSnapshotToDocument(snapshot, doc);
  };

  applySnapshot();
  if (!subscribedDocuments.has(doc)) {
    doc.addEventListener('readystatechange', applySnapshot);
    doc.defaultView?.addEventListener('DOMContentLoaded', applySnapshot, { once: true });
    subscribedDocuments.add(doc);
  }
  return snapshot;
}
