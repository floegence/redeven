import {
  DEFAULT_WORKBENCH_THEME,
  isWorkbenchThemeId,
  type WorkbenchThemeId,
} from '@floegence/floe-webapp-core/workbench';

import { readUIStorageJSON, removeUIStorageItem } from '../services/uiStorage';

export type LegacyWorkbenchAppearanceTone = 'paper' | 'ivory' | 'mist' | 'slate';
export type LegacyWorkbenchAppearanceTexture = 'solid' | 'grid' | 'pin_dot';

export type LegacyWorkbenchAppearance = Readonly<{
  tone: LegacyWorkbenchAppearanceTone;
  texture: LegacyWorkbenchAppearanceTexture;
}>;

export const LEGACY_WORKBENCH_APPEARANCE_STORAGE_KEY = 'redeven_envapp_workbench_appearance_v1';

const LEGACY_WORKBENCH_THEME_MAP = {
  'paper:solid': 'terminal',
  'paper:grid': 'terminal',
  'paper:pin_dot': 'terminal',
  'ivory:solid': 'mica',
  'ivory:grid': 'mica',
  'ivory:pin_dot': 'mica',
  'mist:solid': 'default',
  'mist:grid': 'default',
  'mist:pin_dot': 'default',
  'slate:solid': 'midnight',
  'slate:grid': 'midnight',
  'slate:pin_dot': 'midnight',
} as const satisfies Record<`${LegacyWorkbenchAppearanceTone}:${LegacyWorkbenchAppearanceTexture}`, WorkbenchThemeId>;

function isLegacyWorkbenchAppearanceTone(value: unknown): value is LegacyWorkbenchAppearanceTone {
  return value === 'paper'
    || value === 'ivory'
    || value === 'mist'
    || value === 'slate';
}

function isLegacyWorkbenchAppearanceTexture(value: unknown): value is LegacyWorkbenchAppearanceTexture {
  return value === 'solid'
    || value === 'grid'
    || value === 'pin_dot';
}

export function normalizeLegacyWorkbenchAppearance(value: unknown): LegacyWorkbenchAppearance | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<LegacyWorkbenchAppearance>;
  if (
    !isLegacyWorkbenchAppearanceTone(candidate.tone)
    || !isLegacyWorkbenchAppearanceTexture(candidate.texture)
  ) {
    return null;
  }

  return {
    tone: candidate.tone,
    texture: candidate.texture,
  };
}

export function mapLegacyWorkbenchAppearanceToTheme(
  appearance: LegacyWorkbenchAppearance,
): WorkbenchThemeId {
  return LEGACY_WORKBENCH_THEME_MAP[`${appearance.tone}:${appearance.texture}`]
    ?? DEFAULT_WORKBENCH_THEME;
}

export function normalizeWorkbenchTheme(
  value: unknown,
  fallback: WorkbenchThemeId = DEFAULT_WORKBENCH_THEME,
): WorkbenchThemeId {
  return isWorkbenchThemeId(value) ? value : fallback;
}

export function readLegacyWorkbenchThemeMigration(): Readonly<{
  theme: WorkbenchThemeId | null;
  shouldClearLegacyAppearance: boolean;
}> {
  const appearance = normalizeLegacyWorkbenchAppearance(
    readUIStorageJSON(LEGACY_WORKBENCH_APPEARANCE_STORAGE_KEY, null),
  );
  if (!appearance) {
    return {
      theme: null,
      shouldClearLegacyAppearance: false,
    };
  }

  return {
    theme: mapLegacyWorkbenchAppearanceToTheme(appearance),
    shouldClearLegacyAppearance: true,
  };
}

export function removeLegacyWorkbenchAppearance(): void {
  removeUIStorageItem(LEGACY_WORKBENCH_APPEARANCE_STORAGE_KEY);
}
