import { describe, expect, it, vi } from 'vitest';

import { buildDesktopShellCommandPaletteEntries } from './desktopShellCommandPalette';

describe('desktopShellCommandPalette', () => {
  it('builds Desktop command palette entries with stable copy and actions', async () => {
    const openConnectToRedeven = vi.fn().mockResolvedValue(undefined);
    const openDesktopSettings = vi.fn().mockResolvedValue(undefined);

    const entries = buildDesktopShellCommandPaletteEntries({
      openConnectToRedeven,
      openDesktopSettings,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      'redeven.desktop.connectToRedeven',
      'redeven.desktop.openDesktopSettings',
    ]);
    expect(entries.map((entry) => entry.category)).toEqual(['Desktop', 'Desktop']);
    expect(entries.map((entry) => entry.title)).toEqual([
      'Connect to Redeven...',
      'Open Desktop Settings...',
    ]);

    await entries[0]?.execute();
    await entries[1]?.execute();

    expect(openConnectToRedeven).toHaveBeenCalledTimes(1);
    expect(openDesktopSettings).toHaveBeenCalledTimes(1);
  });
});
