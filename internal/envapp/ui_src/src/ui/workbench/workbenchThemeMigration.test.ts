// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_WORKBENCH_APPEARANCE_STORAGE_KEY,
  mapLegacyWorkbenchAppearanceToTheme,
  normalizeLegacyWorkbenchAppearance,
  normalizeWorkbenchTheme,
  readLegacyWorkbenchThemeMigration,
} from './workbenchThemeMigration';

const storageMocks = vi.hoisted(() => ({
  readUIStorageJSON: vi.fn(() => null),
  removeUIStorageItem: vi.fn(),
}));

vi.mock('../services/uiStorage', () => ({
  readUIStorageJSON: storageMocks.readUIStorageJSON,
  removeUIStorageItem: storageMocks.removeUIStorageItem,
}));

describe('workbenchThemeMigration', () => {
  it('normalizes only valid legacy appearance payloads', () => {
    expect(normalizeLegacyWorkbenchAppearance(null)).toBeNull();
    expect(normalizeLegacyWorkbenchAppearance({ tone: 'mist' })).toBeNull();
    expect(normalizeLegacyWorkbenchAppearance({ tone: 'mist', texture: 'grid' })).toEqual({
      tone: 'mist',
      texture: 'grid',
    });
  });

  it('maps legacy appearance presets to upstream workbench themes', () => {
    expect(mapLegacyWorkbenchAppearanceToTheme({ tone: 'paper', texture: 'solid' })).toBe('terminal');
    expect(mapLegacyWorkbenchAppearanceToTheme({ tone: 'ivory', texture: 'pin_dot' })).toBe('mica');
    expect(mapLegacyWorkbenchAppearanceToTheme({ tone: 'mist', texture: 'grid' })).toBe('default');
    expect(mapLegacyWorkbenchAppearanceToTheme({ tone: 'slate', texture: 'grid' })).toBe('midnight');
  });

  it('reads a one-shot legacy migration seed from storage', () => {
    storageMocks.readUIStorageJSON.mockReturnValueOnce({ tone: 'slate', texture: 'grid' } as any);

    expect(readLegacyWorkbenchThemeMigration()).toEqual({
      theme: 'midnight',
      shouldClearLegacyAppearance: true,
    });
    expect(storageMocks.readUIStorageJSON).toHaveBeenCalledWith(
      LEGACY_WORKBENCH_APPEARANCE_STORAGE_KEY,
      null,
    );
  });

  it('normalizes arbitrary theme values with a default fallback', () => {
    expect(normalizeWorkbenchTheme('mica')).toBe('mica');
    expect(normalizeWorkbenchTheme('unknown')).toBe('default');
  });
});
