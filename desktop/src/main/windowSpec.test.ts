import { describe, expect, it } from 'vitest';

import { resolveDesktopWindowSpec } from './windowSpec';

describe('windowSpec', () => {
  it('keeps the default app window sizing for main windows', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/', false)).toEqual({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
    });
  });

  it('assigns a focused size for detached file previews', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/?redeven_detached_surface=file_preview&path=%2Fworkspace%2Fdemo.txt', true)).toEqual({
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      title: 'File Preview',
      attachToParent: false,
    });
  });

  it('assigns a wider size for detached file browser windows', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/?redeven_detached_surface=file_browser&path=%2Fworkspace', true)).toEqual({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: 'File Browser',
      attachToParent: false,
    });
  });

  it('falls back to default sizing for ordinary child windows', () => {
    expect(resolveDesktopWindowSpec('http://127.0.0.1:23998/_redeven_proxy/env/?tab=ai', true)).toEqual({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
    });
  });
});
