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
  it('uses localized bottom text with a slow left-to-right shimmer', () => {
    const css = flowerStyles();
    const cursorRule = cssRule(css, '.flower-streaming-cursor');
    const textRule = cssRule(css, '.flower-streaming-cursor-text');

    expect(cursorRule).toContain('display: inline-flex');
    expect(cursorRule).toContain('align-items: center');
    expect(textRule).toContain('color: transparent');
    expect(textRule).toContain('90deg');
    expect(textRule).toContain('background-size: 220% 100%');
    expect(textRule).toContain('background-clip: text');
    expect(textRule).toContain('-webkit-background-clip: text');
    expect(textRule).toContain('font-size: 0.75rem');
    expect(textRule).toContain('font-weight: 600');
    expect(textRule).toContain('white-space: nowrap');
    expect(textRule).toContain('animation: flower-cursor-shimmer 2.4s ease-in-out infinite');
    expect(css).toContain('@keyframes flower-cursor-shimmer');
    expect(css).toContain('background-position: -120% 0');
    expect(css).toContain('background-position: 180% 0');
    expect(css).toContain('.flower-streaming-cursor-text,');
    expect(css).toContain('.flower-streaming-cursor-text {\n    color: var(--muted-foreground);');
    expect(css).not.toContain('animation: flower-cursor-flow');
    expect(css).not.toContain('@keyframes flower-cursor-flow');
    expect(css).not.toContain('.flower-streaming-cursor::before');
    expect(cursorRule).not.toContain('width: 1.65rem');
    expect(cursorRule).not.toContain('height: 0.82rem');
  });

  it('keeps the composer action button shape unified for send and stop', () => {
    const css = flowerStyles();
    const submitRule = cssRule(css, '.flower-composer-submit');
    const continueRule = cssRule(css, '.flower-composer-continue');

    expect(submitRule).toContain('width: 2.25rem');
    expect(submitRule).toContain('height: 2.25rem');
    expect(submitRule).toContain('padding: 0');
    expect(continueRule).toContain('min-height: 2.25rem');
    expect(continueRule).toContain('white-space: nowrap');
    expect(continueRule).not.toContain('width: 2.25rem');
    expect(css).not.toContain('flower-composer-submit-stop');
  });
});
