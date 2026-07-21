import { createRequire } from 'node:module';

import type { FloeThemePreset as PublishedFloeThemePreset } from '@floegence/floe-webapp-core';

type FloeThemeMetadataModule = Readonly<{
  BUILT_IN_SHELL_THEME_DEFAULTS: Readonly<Record<'light' | 'dark', string>>;
  builtInShellThemePresets: readonly PublishedFloeThemePreset[];
}>;

// Floe 0.39.2 exposes this browser-neutral entry through a CommonJS-compatible
// default export condition. Keep the require isolated because Desktop's main
// process is compiled with TypeScript's legacy Node resolver.
const requireFloeThemeMetadata = createRequire(__filename);
const floeThemeMetadata = requireFloeThemeMetadata(
  '@floegence/floe-webapp-core/themes',
) as FloeThemeMetadataModule;

export const BUILT_IN_SHELL_THEME_DEFAULTS = floeThemeMetadata.BUILT_IN_SHELL_THEME_DEFAULTS;
export const builtInShellThemePresets = floeThemeMetadata.builtInShellThemePresets;
export type FloeThemePreset = PublishedFloeThemePreset;
