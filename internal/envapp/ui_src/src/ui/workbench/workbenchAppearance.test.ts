import { describe, expect, it } from 'vitest';

import {
  normalizeWorkbenchAppearance,
  resolveDefaultWorkbenchAppearance,
  workbenchAppearanceTextureMeta,
  workbenchAppearanceToneMeta,
} from './workbenchAppearance';

describe('workbenchAppearance', () => {
  it('normalizes only valid persisted appearance payloads', () => {
    expect(normalizeWorkbenchAppearance({
      tone: 'mist',
      texture: 'grid',
    })).toEqual({
      tone: 'mist',
      texture: 'grid',
    });

    expect(normalizeWorkbenchAppearance({
      tone: 'unknown',
      texture: 'grid',
    })).toBeNull();

    expect(normalizeWorkbenchAppearance({
      tone: 'mist',
      texture: 'unknown',
    })).toBeNull();
  });

  it('resolves theme-aware defaults', () => {
    expect(resolveDefaultWorkbenchAppearance('light')).toEqual({
      tone: 'mist',
      texture: 'grid',
    });
    expect(resolveDefaultWorkbenchAppearance('dark')).toEqual({
      tone: 'slate',
      texture: 'grid',
    });
  });

  it('returns stable metadata for tone and texture ids', () => {
    expect(workbenchAppearanceToneMeta('ivory')).toMatchObject({
      id: 'ivory',
      label: 'Ivory',
    });
    expect(workbenchAppearanceTextureMeta('pin_dot')).toMatchObject({
      id: 'pin_dot',
      label: 'Pin Dot',
    });
  });
});
