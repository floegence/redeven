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

describe('Flower activity running sheen', () => {
  it('keeps the subdued running row sheen and square loader on the running row button only', () => {
    const css = flowerStyles();
    const buttonRule = cssRule(css, '.flower-activity-inline-button');
    const sheenRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-button::before');
    const loaderRule = cssRule(css, '.flower-activity-inline-loader');
    const loaderSquareRule = cssRule(css, '.flower-activity-inline-loader-square');

    expect(buttonRule).toContain('position: relative');
    expect(buttonRule).toContain('overflow: hidden');
    expect(sheenRule).toContain('linear-gradient(\n      100deg');
    expect(sheenRule).toContain('width: 18%');
    expect(sheenRule).toContain('color-mix(in srgb, var(--muted-foreground) 12%, transparent)');
    expect(sheenRule).toContain('animation: flower-activity-running-sheen 5.4s cubic-bezier(0.42, 0, 0.2, 1) infinite');
    expect(css).toContain('@keyframes flower-activity-loader-square');
    expect(css).toContain('left: 100%');
    expect(loaderRule).toContain('grid-template-columns: repeat(2, 0.3rem)');
    expect(loaderSquareRule).toContain('animation: flower-activity-loader-square 1.35s ease-in-out infinite');
    expect(css).toContain('.flower-activity-inline-row-running .flower-activity-inline-button::before,');
    expect(css).toContain('.flower-activity-inline-loader-square {');
    expect(css).toContain('content: none !important;');
    expect(css).toContain('opacity: 0 !important;');
    expect(css).toContain('background: none !important;');
    expect(css).not.toContain('.flower-activity-inline-details::before');
    expect(css).not.toContain('.flower-activity-inline-row-running::before');
  });
});
