export const DESKTOP_SHELL_OPEN_WINDOW_CHANNEL = 'redeven-desktop:shell-open-window';

export type DesktopShellWindowKind = 'connect' | 'settings';

export type DesktopShellOpenWindowRequest = Readonly<{
  kind: DesktopShellWindowKind;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeDesktopShellWindowKind(value: unknown): DesktopShellWindowKind | '' {
  const kind = compact(value);
  if (kind === 'connect' || kind === 'settings') {
    return kind;
  }
  return '';
}

export function normalizeDesktopShellOpenWindowRequest(value: unknown): DesktopShellOpenWindowRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellOpenWindowRequest>;
  const kind = normalizeDesktopShellWindowKind(candidate.kind);
  if (!kind) {
    return null;
  }

  return { kind };
}
