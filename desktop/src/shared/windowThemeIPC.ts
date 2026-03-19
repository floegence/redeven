export const REPORT_DESKTOP_WINDOW_THEME_CHANNEL = 'redeven-desktop:report-window-theme';

export type DesktopWindowThemeSnapshot = Readonly<{
  backgroundColor: string;
  symbolColor: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopWindowThemeSnapshot(value: unknown): DesktopWindowThemeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopWindowThemeSnapshot>;
  const backgroundColor = compact(candidate.backgroundColor);
  const symbolColor = compact(candidate.symbolColor);
  if (!backgroundColor || !symbolColor) {
    return null;
  }

  return {
    backgroundColor,
    symbolColor,
  };
}
