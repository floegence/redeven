export const DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL = 'redeven-desktop:ask-flower-handoff-request';
export const DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL = 'redeven-desktop:ask-flower-handoff-deliver';

export type DesktopAskFlowerHandoffPayload = Readonly<{
  source: 'file_preview';
  path: string;
  selectionText: string;
}>;

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

export function normalizeDesktopAskFlowerHandoffPayload(value: unknown): DesktopAskFlowerHandoffPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopAskFlowerHandoffPayload>;
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

export interface DesktopAskFlowerHandoffBridge {
  requestMainWindowHandoff: (payload: DesktopAskFlowerHandoffPayload) => void;
  onMainWindowHandoff: (listener: (payload: DesktopAskFlowerHandoffPayload) => void) => () => void;
}
