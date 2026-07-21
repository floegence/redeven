import { describe, expect, it } from 'vitest';

import {
  desktopRendererThemeSnapshot,
  normalizeDesktopThemeSnapshot,
} from './desktopThemeIPC';

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
  } as const;
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

  it('keeps the main-process semantic projection out of renderer IPC', () => {
    expect(normalizeDesktopThemeSnapshot({
      ...darkSnapshot(),
      semantic: {
        version: 1,
        background: '#0B1A17',
      },
    })).toBeNull();

    expect(desktopRendererThemeSnapshot({
      ...darkSnapshot(),
      semantic: {
        version: 1,
        background: '#0B1A17',
        surface: '#132621',
        muted: '#1C342D',
        foreground: '#EDF6F1',
        mutedForeground: '#A7BDB3',
        border: '#2A453C',
        primary: '#71D0B1',
        primaryForeground: '#0B1A17',
        info: '#79B8FF',
        success: '#72D39C',
        warning: '#F0C36A',
        error: '#FF8A82',
      },
    })).toEqual(darkSnapshot());
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
