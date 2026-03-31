import { describe, expect, it, vi } from 'vitest';

import { buildDesktopShellCommandPaletteEntries } from './desktopShellCommandPalette';

describe('desktopShellCommandPalette', () => {
  it('builds Desktop command palette entries with stable copy and actions', async () => {
    const openConnectionCenter = vi.fn().mockResolvedValue(undefined);
    const openAdvancedSettings = vi.fn().mockResolvedValue(undefined);

    const entries = buildDesktopShellCommandPaletteEntries({
      openConnectionCenter,
      openAdvancedSettings,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      'redeven.desktop.openConnectionCenter',
      'redeven.desktop.openAdvancedSettings',
    ]);
    expect(entries.map((entry) => entry.category)).toEqual(['Desktop', 'Desktop']);
    expect(entries.map((entry) => entry.title)).toEqual([
      'Open Connection Center...',
      'Open Advanced Settings...',
    ]);

    await entries[0]?.execute();
    await entries[1]?.execute();

    expect(openConnectionCenter).toHaveBeenCalledTimes(1);
    expect(openAdvancedSettings).toHaveBeenCalledTimes(1);
  });
});
