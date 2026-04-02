export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';

export type DesktopWindowThemeSnapshot = Readonly<{
  backgroundColor: string;
  symbolColor: string;
}>;

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  window: DesktopWindowThemeSnapshot;
}>;

export const DESKTOP_THEME_SOURCE_STATE_KEY = 'desktop:theme-source';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopThemeSource(value: unknown, fallback: DesktopThemeSource = 'system'): DesktopThemeSource {
  const candidate = compact(value);
  if (candidate === 'system' || candidate === 'light' || candidate === 'dark') {
    return candidate;
  }
  return fallback;
}

export function sameDesktopWindowThemeSnapshot(
  left: DesktopWindowThemeSnapshot,
  right: DesktopWindowThemeSnapshot,
): boolean {
  return left.backgroundColor === right.backgroundColor
    && left.symbolColor === right.symbolColor;
}

export function sameDesktopThemeSnapshot(left: DesktopThemeSnapshot, right: DesktopThemeSnapshot): boolean {
  return left.source === right.source
    && left.resolvedTheme === right.resolvedTheme
    && sameDesktopWindowThemeSnapshot(left.window, right.window);
}
