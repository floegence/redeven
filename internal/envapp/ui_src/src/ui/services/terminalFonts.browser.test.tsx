import { describe, expect, it } from 'vitest';
import { createTerminalFontCatalog } from './terminalFonts';

describe('packaged terminal font files', () => {
  it('loads distinct bundled fonts into private families and measures actual glyphs', async () => {
    const fonts = createTerminalFontCatalog();
    await Promise.all([fonts.prepare('jetbrains'), fonts.prepare('iosevka')]);
    const context = document.createElement('canvas').getContext('2d')!;
    const widths: number[] = [];
    for (const id of ['jetbrains', 'iosevka']) {
      const resolved = fonts.resolve(id);
      expect(resolved.status).toBe('ready');
      expect(resolved.effectiveID).toBe(id);
      const loadedFaces = await document.fonts.load(`14px "Redeven Terminal ${id}"`, 'M');
      expect(loadedFaces.length).toBeGreaterThan(0);
      expect(loadedFaces.every((face) => face.status === 'loaded')).toBe(true);
      context.font = `14px ${resolved.family}`;
      const width = context.measureText('M').width;
      widths.push(width);
      expect(width).toBeGreaterThan(6);
      for (const glyph of 'i0O1l[]{}') expect(context.measureText(glyph).width).toBeCloseTo(width, 2);
    }
    expect(widths[0]).toBeGreaterThan(widths[1]! + 1);
  });

  it('does not accept a generic fallback as proof a local font exists', async () => {
    const fonts = createTerminalFontCatalog();
    await fonts.prepare('consolas');
    const localFace = new FontFace('Probe Consolas', 'local("Consolas")');
    const available = await localFace.load().then(() => true, () => false);
    expect(fonts.resolve('consolas').effectiveID).toBe(available ? 'consolas' : 'jetbrains');
    expect(fonts.state('consolas')).toBe(available ? 'ready' : 'unavailable');
  });
});
