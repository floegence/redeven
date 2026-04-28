export const TERMINAL_MIN_FONT_SIZE = 10;
export const TERMINAL_MAX_FONT_SIZE = 20;
export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const DEFAULT_TERMINAL_FONT_FAMILY_ID = 'monaco';

export type TerminalGeometryPreferences = Readonly<{
  fontSize: number;
  fontFamilyId: string;
}>;

export function normalizeTerminalFontSize(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  return Math.max(TERMINAL_MIN_FONT_SIZE, Math.min(TERMINAL_MAX_FONT_SIZE, Math.round(next)));
}

export function normalizeTerminalFontFamilyId(value: unknown): string {
  const next = String(value ?? '').trim();
  return next || DEFAULT_TERMINAL_FONT_FAMILY_ID;
}

export function normalizeTerminalGeometryPreferences(
  value: Partial<TerminalGeometryPreferences> | null | undefined,
): TerminalGeometryPreferences {
  return {
    fontSize: normalizeTerminalFontSize(value?.fontSize),
    fontFamilyId: normalizeTerminalFontFamilyId(value?.fontFamilyId),
  };
}
