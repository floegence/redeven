import { describe, expect, it, vi } from 'vitest';
import { createTerminalFontCatalog, TERMINAL_FONT_OPTIONS } from './terminalFonts';

describe('packaged terminal font files', () => {
  it('loads distinct bundled fonts into private families and measures actual glyphs', async () => {
    const fonts = createTerminalFontCatalog();
    const bundledIDs = ['jetbrains', 'iosevka', 'source-code-pro', 'ibm-plex-mono'];
    await Promise.all(bundledIDs.map((id) => fonts.prepare(id)));
    const context = document.createElement('canvas').getContext('2d')!;
    const widths: number[] = [];
    const rasters = new Set<string>();
    for (const id of bundledIDs) {
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
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.fillText('0O 1lI {} []', 0, 20);
      rasters.add(context.canvas.toDataURL());
    }
    expect(widths[0]).toBeGreaterThan(widths[1]! + 1);
    expect(rasters.size).toBe(4);
  });

  it('does not accept a generic fallback as proof a local font exists', async () => {
    const fonts = createTerminalFontCatalog();
    await fonts.prepare('consolas');
    const localFace = new FontFace('Probe Consolas', 'local("Consolas")');
    const available = await localFace.load().then(() => true, () => false);
    expect(fonts.resolve('consolas').effectiveID).toBe(available ? 'consolas' : 'jetbrains');
    expect(fonts.state('consolas')).toBe(available ? 'ready' : 'unavailable');
  });

  it.each(['iosevka', 'source-code-pro', 'ibm-plex-mono'])('recovers a failed $0 resource through explicit retry and a real loaded face', async (id) => {
    const fetch = globalThis.fetch.bind(globalThis);
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
      String(url).includes(id) ? Promise.resolve(new Response(null, { status: 503 })) : fetch(url, init));
    const fonts = createTerminalFontCatalog();
    try {
      await fonts.prepare(id);
      expect(fonts.resolve(id)).toMatchObject({ requestedID: id, effectiveID: 'jetbrains', status: 'fallback' });
    } finally {
      request.mockRestore();
    }
    await fonts.prepare(id, true);
    expect(fonts.resolve(id)).toMatchObject({ effectiveID: id, status: 'ready' });
    const faces = await document.fonts.load(`14px "Redeven Terminal ${id}"`, 'M');
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((face) => face.status === 'loaded')).toBe(true);
  });

  it('only accepts a locally loaded face for every installed-font candidate', async () => {
    const fonts = createTerminalFontCatalog();
    for (const option of TERMINAL_FONT_OPTIONS.filter((font) => font.kind === 'local')) {
      await fonts.prepare(option.id);
      const face = new FontFace(`Independent ${option.id}`, (option.localNames ?? [option.label]).map((name) => `local("${name}")`).join(', '));
      const available = await face.load().then(() => true, () => false);
      expect(fonts.resolve(option.id).effectiveID).toBe(available ? option.id : 'jetbrains');
    }
  });
});
