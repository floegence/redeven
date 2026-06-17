import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');

function flowerStyles(): string {
  return fs.readFileSync(stylesPath, 'utf8');
}

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

describe('Flower streaming cursor', () => {
  it('uses a vertical terminal-style cursor with slow breathing shimmer', () => {
    const css = flowerStyles();
    const cursorRule = cssRule(css, '.flower-streaming-cursor');
    const shimmerRule = cssRule(css, '.flower-streaming-cursor::before');

    expect(cursorRule).toContain('width: 0.42em');
    expect(cursorRule).toContain('height: 1.15em');
    expect(cursorRule).toContain('border-radius: 0.08rem');
    expect(cursorRule).toContain('animation: flower-cursor-breathe 2.8s ease-in-out infinite');
    expect(shimmerRule).toContain('animation: flower-cursor-shimmer 2.8s ease-in-out infinite');
    expect(css).toContain('.flower-streaming-cursor::before,');
    expect(css).not.toContain('animation: flower-cursor-flow');
    expect(css).not.toContain('@keyframes flower-cursor-flow');
    expect(cursorRule).not.toContain('width: 1.65rem');
    expect(cursorRule).not.toContain('height: 0.82rem');
  });
});
