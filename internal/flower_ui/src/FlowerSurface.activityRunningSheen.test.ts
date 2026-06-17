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
  it('keeps the slow left-to-right sheen on the running row button only', () => {
    const css = flowerStyles();
    const buttonRule = cssRule(css, '.flower-activity-inline-button');
    const sheenRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-button::before');

    expect(buttonRule).toContain('position: relative');
    expect(buttonRule).toContain('overflow: hidden');
    expect(sheenRule).toContain('linear-gradient(\n      100deg');
    expect(sheenRule).toContain('transform: translateX(-112%)');
    expect(sheenRule).toContain('animation: flower-activity-running-sheen 4.6s cubic-bezier(0.45, 0, 0.2, 1) infinite');
    expect(css).toContain('transform: translateX(112%)');
    expect(css).toContain('.flower-activity-inline-row-running .flower-activity-inline-button::before,');
    expect(css).not.toContain('.flower-activity-inline-details::before');
    expect(css).not.toContain('.flower-activity-inline-row-running::before');
  });
});
