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
  it('uses a vertical terminal-style cursor with slow left-to-right shimmer', () => {
    const css = flowerStyles();
    const cursorRule = cssRule(css, '.flower-streaming-cursor');
    const shimmerRule = cssRule(css, '.flower-streaming-cursor::before');

    expect(cursorRule).toContain('width: 0.42em');
    expect(cursorRule).toContain('height: 1.15em');
    expect(cursorRule).toContain('border-radius: 0.08rem');
    expect(cursorRule).toContain('animation: flower-cursor-breathe 3.8s ease-in-out infinite');
    expect(shimmerRule).toContain('90deg');
    expect(shimmerRule).toContain('transform: translateX(-54%)');
    expect(shimmerRule).toContain('animation: flower-cursor-shimmer 3.8s cubic-bezier(0.42, 0, 0.2, 1) infinite');
    expect(css).toContain('transform: translateX(54%)');
    expect(css).toContain('.flower-streaming-cursor::before,');
    expect(css).not.toContain('animation: flower-cursor-flow');
    expect(css).not.toContain('@keyframes flower-cursor-flow');
    expect(cursorRule).not.toContain('width: 1.65rem');
    expect(cursorRule).not.toContain('height: 0.82rem');
  });

  it('keeps the composer action button shape unified for send and stop', () => {
    const css = flowerStyles();
    const submitRule = cssRule(css, '.flower-composer-submit');

    expect(submitRule).toContain('width: 2.25rem');
    expect(submitRule).toContain('height: 2.25rem');
    expect(submitRule).toContain('padding: 0');
    expect(css).not.toContain('flower-composer-submit-stop');
  });
});
