import { describe, expect, it, vi } from 'vitest';

import { buildDesktopShellCommandPaletteEntries } from './desktopShellCommandPalette';

describe('desktopShellCommandPalette', () => {
  it('builds the single Desktop chooser command palette entry', async () => {
    const openDeviceChooser = vi.fn().mockResolvedValue(undefined);

    const entries = buildDesktopShellCommandPaletteEntries({
      openDeviceChooser,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      'redeven.desktop.switchDevice',
    ]);
    expect(entries.map((entry) => entry.category)).toEqual(['Desktop']);
    expect(entries.map((entry) => entry.title)).toEqual([
      'Switch Device...',
    ]);

    await entries[0]?.execute();

    expect(openDeviceChooser).toHaveBeenCalledTimes(1);
  });
});
