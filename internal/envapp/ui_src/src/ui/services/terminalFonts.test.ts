import { describe, expect, it, vi } from 'vitest';
import { createTerminalFontCatalog, TERMINAL_FONT_OPTIONS } from './terminalFonts';

describe('terminal font resolution', () => {
  it('offers stable candidates across Windows, Linux and macOS without platform gating', () => {
    expect(TERMINAL_FONT_OPTIONS.map((font) => font.id)).toEqual([
      'jetbrains', 'iosevka', 'cascadia-mono', 'consolas', 'dejavu-sans-mono',
      'liberation-mono', 'ubuntu-mono', 'sfmono', 'menlo', 'monaco',
    ]);
    expect(new Set(TERMINAL_FONT_OPTIONS.map((font) => font.family)).size).toBe(10);
  });

  it('keeps the shared selection when one device falls back and another has the requested font', async () => {
    const windows = createTerminalFontCatalog(async (font) => { if (font.id === 'monaco') throw new Error('missing'); });
    const mac = createTerminalFontCatalog(async () => {});
    const saved = Object.freeze({ fontFamilyId: 'monaco', fontSize: 12 });
    await Promise.all([windows.prepare(saved.fontFamilyId), mac.prepare(saved.fontFamilyId)]);
    expect(windows.resolve(saved.fontFamilyId)).toMatchObject({ requestedID: 'monaco', effectiveID: 'jetbrains', status: 'fallback' });
    expect(mac.resolve(saved.fontFamilyId)).toMatchObject({ requestedID: 'monaco', effectiveID: 'monaco', status: 'ready' });
    expect(saved).toEqual({ fontFamilyId: 'monaco', fontSize: 12 });
  });

  it('uses an explicitly loaded local font without substituting another installed family', async () => {
    const load = vi.fn(async () => {});
    const fonts = createTerminalFontCatalog(load);
    await fonts.prepare('consolas');
    expect(fonts.resolve('consolas')).toMatchObject({ effectiveID: 'consolas', family: '"Redeven Terminal consolas", monospace', status: 'ready' });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ label: 'Consolas', kind: 'local' }), expect.any(AbortSignal));
  });

  it('deduplicates concurrent loads and requires an explicit retry after failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const fonts = createTerminalFontCatalog(load);
    await Promise.all([fonts.prepare('jetbrains'), fonts.prepare('jetbrains')]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fonts.resolve('jetbrains')).toMatchObject({ status: 'failed', effectiveID: null, family: 'monospace' });
    await fonts.prepare('jetbrains');
    expect(load).toHaveBeenCalledTimes(1);
    await fonts.prepare('jetbrains', true);
    expect(fonts.resolve('jetbrains')).toMatchObject({ status: 'ready', effectiveID: 'jetbrains' });
  });

  it('does not let a late previous font replace the current selection', async () => {
    let finish: () => void = () => {};
    const fonts = createTerminalFontCatalog((font) => font.id === 'monaco'
      ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
    const previous = fonts.prepare('monaco');
    await fonts.prepare('consolas');
    expect(fonts.resolve('consolas').effectiveID).toBe('consolas');
    finish();
    await previous;
    expect(fonts.resolve('consolas').effectiveID).toBe('consolas');
  });

  it('retains unknown saved IDs while resolving a documented fallback', async () => {
    const fonts = createTerminalFontCatalog(async () => {});
    await fonts.prepare('future-font');
    expect(fonts.resolve('future-font')).toMatchObject({ requestedID: 'future-font', effectiveID: 'jetbrains', status: 'fallback' });
  });

  it('bounds stalled loads and ignores a late completion after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let finish: () => void = () => {};
      let signal: AbortSignal | undefined;
      const fonts = createTerminalFontCatalog((_, nextSignal) => {
        signal = nextSignal;
        return new Promise<void>((resolve) => { finish = resolve; });
      });
      const pending = fonts.prepare('jetbrains');
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(signal?.aborted).toBe(true);
      expect(fonts.resolve('jetbrains')).toMatchObject({ status: 'failed', family: 'monospace' });
      finish();
      await Promise.resolve();
      expect(fonts.state('jetbrains')).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});
