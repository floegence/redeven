import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENVAPP_MOBILE_VIEWPORT_CONTENT,
  resolveTerminalSurfaceTouchAction,
} from './mobileViewportPolicy';

describe('mobile viewport policy', () => {
  it('keeps envapp viewport locked to app-style mobile scaling', () => {
    const indexHtmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    expect(html).toContain(`content="${ENVAPP_MOBILE_VIEWPORT_CONTENT}"`);
  });

  it('disables pinch zoom on the terminal surface while preserving custom mobile scrolling', () => {
    expect(resolveTerminalSurfaceTouchAction(true)).toBe('pan-x');
    expect(resolveTerminalSurfaceTouchAction(false)).toBe('');
  });
});
