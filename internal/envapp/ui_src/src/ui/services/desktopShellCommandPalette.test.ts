import { describe, expect, it, vi } from 'vitest';

import { buildDesktopShellCommandPaletteEntries } from './desktopShellCommandPalette';

describe('desktopShellCommandPalette', () => {
  it('builds the single Desktop chooser command palette entry', async () => {
    const openEnvironmentLauncher = vi.fn().mockResolvedValue(undefined);

    const entries = buildDesktopShellCommandPaletteEntries({
      openEnvironmentLauncher,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      'redeven.desktop.openEnvironment',
    ]);
    expect(entries.map((entry) => entry.category)).toEqual(['Desktop']);
    expect(entries.map((entry) => entry.title)).toEqual([
      'Open Environment...',
    ]);

    await entries[0]?.execute();

    expect(openEnvironmentLauncher).toHaveBeenCalledTimes(1);
  });
});
