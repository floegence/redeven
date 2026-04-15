export type DesktopBridgeName =
  | 'redevenDesktopTheme'
  | 'redevenDesktopSessionContext'
  | 'redevenDesktopStateStorage'
  | 'redevenDesktopWindowChrome';

export type DesktopHostWindow = Window;

const DESKTOP_BRIDGE_NAMES: readonly DesktopBridgeName[] = [
  'redevenDesktopTheme',
  'redevenDesktopSessionContext',
  'redevenDesktopStateStorage',
  'redevenDesktopWindowChrome',
] as const;

function desktopHostWindowCandidates(currentWindow: Window): DesktopHostWindow[] {
  const candidates: DesktopHostWindow[] = [];

  const currentCandidate = sameOriginDesktopWindow(currentWindow, currentWindow);
  if (currentCandidate) {
    candidates.push(currentCandidate);
  }

  const parentCandidate = sameOriginDesktopWindow(currentWindow, currentWindow.parent);
  if (parentCandidate && !candidates.includes(parentCandidate)) {
    candidates.push(parentCandidate);
  }

  const topCandidate = sameOriginDesktopWindow(currentWindow, currentWindow.top);
  if (topCandidate && !candidates.includes(topCandidate)) {
    candidates.push(topCandidate);
  }

  return candidates;
}

function sameOriginDesktopWindow(
  currentWindow: Pick<Window, 'location'>,
  candidate: unknown,
): DesktopHostWindow | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  try {
    const candidateWindow = candidate as DesktopHostWindow;
    if (candidateWindow.location.origin !== currentWindow.location.origin) {
      return null;
    }
    return candidateWindow;
  } catch {
    return null;
  }
}

export function hasDesktopBridge(candidate: unknown): candidate is DesktopHostWindow {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const hostWindow = candidate as Record<DesktopBridgeName, unknown>;
  return DESKTOP_BRIDGE_NAMES.some((bridgeName) => bridgeName in hostWindow);
}

export function resolveDesktopHostWindow(currentWindow: Window = window): DesktopHostWindow | null {
  return desktopHostWindowCandidates(currentWindow).find((candidate) => hasDesktopBridge(candidate)) ?? null;
}

export function readDesktopHostBridge<T>(
  bridgeName: DesktopBridgeName,
  isBridge: (candidate: unknown) => candidate is T,
  currentWindow: Window = window,
): T | null {
  for (const hostWindow of desktopHostWindowCandidates(currentWindow)) {
    const candidate = (hostWindow as unknown as Record<DesktopBridgeName, unknown>)[bridgeName];
    if (isBridge(candidate)) {
      return candidate;
    }
  }

  return null;
}
