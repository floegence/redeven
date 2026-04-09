export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';
export type DesktopHexColor = `#${string}`;

export type DesktopWindowThemeSnapshot = Readonly<{
  backgroundColor: DesktopHexColor;
  symbolColor: DesktopHexColor;
}>;

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  window: DesktopWindowThemeSnapshot;
}>;

export const DESKTOP_THEME_SOURCE_STATE_KEY = 'desktop:theme-source';
const DESKTOP_HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function isDesktopHexColor(value: unknown): value is DesktopHexColor {
  return DESKTOP_HEX_COLOR_PATTERN.test(compact(value));
}

export function normalizeDesktopHexColor(value: unknown): DesktopHexColor | '' {
  return isDesktopHexColor(value) ? value : '';
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
