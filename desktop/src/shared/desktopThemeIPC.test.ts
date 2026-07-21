import { describe, expect, it } from 'vitest';

import { normalizeDesktopThemeSnapshot } from './desktopThemeIPC';

function darkSnapshot() {
  return {
    source: 'dark',
    resolvedTheme: 'dark',
    shellThemes: {
      version: 1,
      light: 'mist',
      dark: 'forest',
    },
    activeShellTheme: 'forest',
    window: {
      backgroundColor: '#0b1a17',
      symbolColor: '#edf6f1',
    },
  };
}

describe('normalizeDesktopThemeSnapshot', () => {
  it('accepts a complete, internally consistent snapshot', () => {
    expect(normalizeDesktopThemeSnapshot(darkSnapshot())).toEqual(darkSnapshot());
  });

  it('rejects snapshots whose native window colors are not hex values', () => {
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      window: {
        backgroundColor: 'hsl(222 30% 8%)',
        symbolColor: '#edf6f1',
      },
    })).toBeNull();
  });

  it('rejects source, resolved mode, and active preset inconsistencies', () => {
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      source: 'light',
    })).toBeNull();
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      activeShellTheme: 'mist',
    })).toBeNull();
  });

  it('rejects malformed, unknown, and cross-mode selections', () => {
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      shellThemes: {
        version: 2,
        light: 'mist',
        dark: 'forest',
      },
    })).toBeNull();
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      shellThemes: {
        version: 1,
        light: 'ocean',
        dark: 'forest',
      },
    })).toBeNull();
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      shellThemes: {
        version: 1,
        light: 'mist',
        dark: 'future-dark',
      },
    })).toBeNull();
  });
});
