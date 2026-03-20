export type DesktopAskFlowerMainWindowHandoff = Readonly<{
  source: 'file_preview';
  path: string;
  selectionText: string;
}>;

export interface DesktopAskFlowerBridge {
  requestMainWindowHandoff: (payload: DesktopAskFlowerMainWindowHandoff) => void;
  onMainWindowHandoff: (listener: (payload: DesktopAskFlowerMainWindowHandoff) => void) => () => void;
}

declare global {
  interface Window {
    redevenDesktopAskFlowerHandoff?: DesktopAskFlowerBridge;
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAbsolutePath(value: unknown): string {
  const raw = compact(value);
  if (!raw || !raw.startsWith('/')) {
    return '';
  }
  if (raw === '/') {
    return '/';
  }
  return raw.replace(/\/+$/, '') || '/';
}

function normalizeDesktopAskFlowerMainWindowHandoff(value: unknown): DesktopAskFlowerMainWindowHandoff | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopAskFlowerMainWindowHandoff>;
  const source = compact(candidate.source);
  const path = normalizeAbsolutePath(candidate.path);
  if (source !== 'file_preview' || !path) {
    return null;
  }

  return {
    source: 'file_preview',
    path,
    selectionText: compact(candidate.selectionText),
  };
}

function looksLikeElectronRenderer(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return String(navigator.userAgent ?? '').includes('Electron');
}

function desktopAskFlowerBridge(): DesktopAskFlowerBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window.redevenDesktopAskFlowerHandoff;
  if (!candidate) {
    return null;
  }
  if (
    typeof candidate.requestMainWindowHandoff !== 'function'
    || typeof candidate.onMainWindowHandoff !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export function shouldRequireDesktopAskFlowerMainWindowHandoff(): boolean {
  return looksLikeElectronRenderer();
}

export function requestDesktopAskFlowerMainWindowHandoff(payload: DesktopAskFlowerMainWindowHandoff): boolean {
  const bridge = desktopAskFlowerBridge();
  const normalized = normalizeDesktopAskFlowerMainWindowHandoff(payload);
  if (!bridge || !normalized) {
    return false;
  }

  bridge.requestMainWindowHandoff(normalized);
  return true;
}

export function subscribeDesktopAskFlowerMainWindowHandoff(
  listener: (payload: DesktopAskFlowerMainWindowHandoff) => void,
): () => void {
  const bridge = desktopAskFlowerBridge();
  if (!bridge || typeof listener !== 'function') {
    return () => undefined;
  }

  return bridge.onMainWindowHandoff((payload) => {
    const normalized = normalizeDesktopAskFlowerMainWindowHandoff(payload);
    if (!normalized) {
      return;
    }
    listener(normalized);
  });
}
