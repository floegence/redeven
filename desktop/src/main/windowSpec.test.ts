import { describe, expect, it } from 'vitest';

import { resolveDesktopWindowSpec } from './windowSpec';

describe('windowSpec', () => {
  it('opens previews as independent resizable reading windows', () => {
    expect(resolveDesktopWindowSpec('https://env/_redeven_proxy/env/?window=file-preview&path=%2Fa.html', true)).toEqual({ width: 1100, height: 800, minWidth: 480, minHeight: 360, attachToParent: false });
  });
  it('keeps the default app window sizing for main windows', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/', false)).toEqual({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
    });
  });

  it('keeps the same default sizing for ordinary child windows', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/?tab=ai', true)).toEqual({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
    });
  });
});
