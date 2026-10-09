import { describe, expect, it } from 'vitest';
import { normalizeDesktopShellOpenServiceCanvasWindowRequest as request, normalizeDesktopShellOpenServiceCanvasWindowResponse as response } from './desktopShellServiceCanvasWindowIPC';

describe('Service Canvas window requests', () => {
  it('accepts the library, current canvas, and an exact saved version', () => {
    expect(request({})).toEqual({});
    expect(request({ canvas_id: 'commerce' })).toEqual({ canvas_id: 'commerce' });
    expect(request({ canvas_id: 'commerce', version: 4 })).toEqual({ canvas_id: 'commerce', version: 4 });
  });

  it.each([null, [], 'commerce', { url: 'https://other.example/' }, { host: 'other' },
    { canvas_id: '../secret' }, { canvas_id: '' }, { canvas_id: 1 }, { canvas_id: 'x'.repeat(129) },
    { version: 4 }, { canvas_id: 'commerce', version: 0 }, { canvas_id: 'commerce', version: 1.5 },
    { canvas_id: 'commerce', version: '4' }, { canvas_id: 'commerce', version: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid or renderer-selected routing input: %j', value => {
    expect(request(value)).toBeNull();
  });

  it('requires an explicit native acknowledgement', () => {
    expect(response({ ok: true })).toEqual({ ok: true });
    for (const value of [null, undefined, true, { ok: false }, { ok: 'true' }]) expect(response(value)).toEqual({ ok: false });
  });
});
