export type DesktopThemePalette = Readonly<{
  windowBackground: string;
  pageBackground: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}>;

export const desktopLightTheme = {
  windowBackground: 'hsl(36 15% 93%)',
  pageBackground: 'hsl(36 15% 93%)',
  surface: 'hsl(36 12% 96%)',
  surfaceMuted: 'hsl(36 10% 88%)',
  border: 'hsl(36 10% 82%)',
  text: 'hsl(215 40% 13%)',
  muted: 'hsl(215 20% 42%)',
  accent: 'hsl(215 40% 13%)',
  accentText: 'hsl(0 0% 98%)',
  accentSoft: 'hsl(36 12% 91%)',
  success: 'oklch(0.68 0.16 150)',
  warning: 'oklch(0.78 0.14 80)',
  danger: 'oklch(0.65 0.2 25)',
  info: 'oklch(0.65 0.13 250)',
} as const satisfies DesktopThemePalette;

export const desktopDarkTheme = {
  windowBackground: 'hsl(222 30% 8%)',
  pageBackground: 'hsl(222 30% 8%)',
  surface: 'hsl(222 28% 10%)',
  surfaceMuted: 'hsl(220 25% 14%)',
  border: 'hsl(220 20% 18%)',
  text: 'hsl(210 20% 98%)',
  muted: 'hsl(215 20% 60%)',
  accent: 'hsl(210 20% 98%)',
  accentText: 'hsl(222 30% 10%)',
  accentSoft: 'hsl(220 25% 16%)',
  success: 'oklch(0.72 0.19 150)',
  warning: 'oklch(0.82 0.16 80)',
  danger: 'oklch(0.7 0.22 25)',
  info: 'oklch(0.7 0.15 250)',
} as const satisfies DesktopThemePalette;

export const desktopTheme = desktopLightTheme;
