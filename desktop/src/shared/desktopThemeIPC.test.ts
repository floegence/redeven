import { describe, expect, it } from 'vitest';

import { normalizeDesktopThemeSnapshot } from './desktopThemeIPC';

describe('normalizeDesktopThemeSnapshot', () => {
  it('accepts snapshots whose native window colors use hex values', () => {
    expect(normalizeDesktopThemeSnapshot({
      source: 'dark',
      resolvedTheme: 'dark',
      window: {
        backgroundColor: '#0e121b',
        symbolColor: '#f9fafb',
      },
    })).toEqual({
      source: 'dark',
      resolvedTheme: 'dark',
      window: {
        backgroundColor: '#0e121b',
        symbolColor: '#f9fafb',
      },
    });
  });

  it('rejects snapshots whose native window colors are not hex values', () => {
    expect(normalizeDesktopThemeSnapshot({
      source: 'dark',
      resolvedTheme: 'dark',
      window: {
        backgroundColor: 'hsl(222 30% 8%)',
        symbolColor: '#f9fafb',
      },
    })).toBeNull();
  });
});
