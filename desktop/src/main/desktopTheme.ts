import {
  builtInShellThemePresets,
  type FloeThemePreset,
} from '../shared/floeThemeMetadata';

import {
  DESKTOP_SHELL_THEME_DEFAULTS,
  DESKTOP_SHELL_THEME_PRESETS,
  DESKTOP_THEME_SEMANTIC_PALETTE_VERSION,
  isDesktopCssColor,
  isDesktopHexColor,
  type DesktopResolvedTheme,
  type DesktopShellThemePreset,
  type DesktopThemeSemanticPalette,
  type DesktopWindowThemeSnapshot,
} from '../shared/desktopTheme';

export type DesktopShellThemeCatalogEntry = Readonly<{
  mode: DesktopResolvedTheme;
  window: DesktopWindowThemeSnapshot;
}>;

const PUBLISHED_PRESETS = new Map(
  builtInShellThemePresets.map((preset) => [preset.name, preset]),
);

function publishedPreset(name: DesktopShellThemePreset): FloeThemePreset {
  const preset = PUBLISHED_PRESETS.get(name);
  if (!preset || (preset.mode !== 'light' && preset.mode !== 'dark')) {
    throw new Error(`Floe theme preset ${name} is missing or has an invalid mode`);
  }
  return preset;
}

function semanticToken(preset: FloeThemePreset, tokenName: string): string {
  const value = preset.semanticTokens?.[`--${tokenName}`];
  if (!isDesktopCssColor(value)) {
    throw new Error(`Floe theme preset ${preset.name} is missing --${tokenName}`);
  }
  return value;
}

function nativeHexColor(preset: FloeThemePreset, value: string | undefined, role: string): `#${string}` {
  if (!isDesktopHexColor(value)) {
    throw new Error(`Floe theme preset ${preset.name} has a non-HEX ${role} color`);
  }
  return value.toLowerCase() as `#${string}`;
}

const classicLightWindow = {
  backgroundColor: '#f4f1ed',
  symbolColor: '#202a37',
} as const satisfies DesktopWindowThemeSnapshot;

const classicDarkWindow = {
  backgroundColor: '#0e121b',
  symbolColor: '#f9fafb',
} as const satisfies DesktopWindowThemeSnapshot;

function semanticPaletteForPublishedPreset(
  name: DesktopShellThemePreset,
): DesktopThemeSemanticPalette {
  const preset = publishedPreset(name);
  return {
    version: DESKTOP_THEME_SEMANTIC_PALETTE_VERSION,
    background: semanticToken(preset, 'background') as DesktopThemeSemanticPalette['background'],
    surface: semanticToken(preset, 'card') as DesktopThemeSemanticPalette['surface'],
    muted: semanticToken(preset, 'muted') as DesktopThemeSemanticPalette['muted'],
    foreground: semanticToken(preset, 'foreground') as DesktopThemeSemanticPalette['foreground'],
    mutedForeground: semanticToken(preset, 'muted-foreground') as DesktopThemeSemanticPalette['mutedForeground'],
    border: semanticToken(preset, 'border') as DesktopThemeSemanticPalette['border'],
    primary: semanticToken(preset, 'primary') as DesktopThemeSemanticPalette['primary'],
    primaryForeground: semanticToken(preset, 'primary-foreground') as DesktopThemeSemanticPalette['primaryForeground'],
    info: semanticToken(preset, 'info') as DesktopThemeSemanticPalette['info'],
    success: semanticToken(preset, 'success') as DesktopThemeSemanticPalette['success'],
    warning: semanticToken(preset, 'warning') as DesktopThemeSemanticPalette['warning'],
    error: semanticToken(preset, 'error') as DesktopThemeSemanticPalette['error'],
  };
}

function windowSnapshotForPublishedPreset(name: DesktopShellThemePreset): DesktopWindowThemeSnapshot {
  const preset = publishedPreset(name);
  const semantic = semanticPaletteForPublishedPreset(name);
  return {
    backgroundColor: name === 'classic-light'
      ? classicLightWindow.backgroundColor
      : name === 'classic-dark'
        ? classicDarkWindow.backgroundColor
        : nativeHexColor(preset, preset.preview?.background, 'preview background'),
    symbolColor: name === 'classic-light'
      ? classicLightWindow.symbolColor
      : name === 'classic-dark'
        ? classicDarkWindow.symbolColor
        : nativeHexColor(preset, semantic.foreground, 'foreground'),
  };
}

const allPresetNames = [
  ...DESKTOP_SHELL_THEME_PRESETS.light,
  ...DESKTOP_SHELL_THEME_PRESETS.dark,
] as readonly DesktopShellThemePreset[];

export const desktopShellThemeCatalog = Object.fromEntries(
  allPresetNames.map((name) => [name, {
    mode: publishedPreset(name).mode as DesktopResolvedTheme,
    window: windowSnapshotForPublishedPreset(name),
  }]),
) as Readonly<Record<DesktopShellThemePreset, DesktopShellThemeCatalogEntry>>;

export const desktopShellThemeSemanticCatalog = Object.fromEntries(
  allPresetNames.map((name) => [name, semanticPaletteForPublishedPreset(name)]),
) as Readonly<Record<DesktopShellThemePreset, DesktopThemeSemanticPalette>>;

export function desktopSemanticPaletteForShellTheme(
  preset: DesktopShellThemePreset,
): DesktopThemeSemanticPalette {
  return desktopShellThemeSemanticCatalog[preset];
}

export function desktopWindowThemeSnapshotForResolvedTheme(
  resolvedTheme: DesktopResolvedTheme,
): DesktopWindowThemeSnapshot {
  return desktopWindowThemeSnapshotForShellTheme(DESKTOP_SHELL_THEME_DEFAULTS[resolvedTheme]);
}

export function desktopWindowThemeSnapshotForShellTheme(
  preset: DesktopShellThemePreset,
): DesktopWindowThemeSnapshot {
  return desktopShellThemeCatalog[preset].window;
}
