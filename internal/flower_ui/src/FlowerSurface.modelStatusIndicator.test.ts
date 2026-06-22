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

describe('Flower model status indicator', () => {
  it('uses readable localized dock text with a decorative left-to-right shimmer', () => {
    const css = flowerStyles();
    const laneRule = cssRule(css, '.flower-model-status-lane');
    const indicatorRule = cssRule(css, '.flower-model-status-indicator');
    const textRule = cssRule(css, '.flower-model-status-text');
    const shimmerRule = cssRule(css, '.flower-model-status-text::after');

    expect(laneRule).toContain('min-height: 1.35rem');
    expect(laneRule).toContain('align-items: center');
    expect(indicatorRule).toContain('display: inline-flex');
    expect(indicatorRule).toContain('align-items: center');
    expect(textRule).toContain('font-size: 0.75rem');
    expect(textRule).toContain('font-weight: 600');
    expect(textRule).toContain('white-space: nowrap');
    expect(textRule).toContain('color: color-mix(in srgb, var(--muted-foreground) 78%, var(--foreground) 22%)');
    expect(textRule).not.toContain('color: transparent');
    expect(textRule).not.toContain('-webkit-text-fill-color: transparent');
    expect(shimmerRule).toContain('content: attr(data-text)');
    expect(shimmerRule).toContain('position: absolute');
    expect(shimmerRule).toContain('pointer-events: none');
    expect(shimmerRule).toContain('color: transparent');
    expect(shimmerRule).toContain('90deg');
    expect(shimmerRule).toContain('background-size: 220% 100%');
    expect(shimmerRule).toContain('background-clip: text');
    expect(shimmerRule).toContain('-webkit-background-clip: text');
    expect(shimmerRule).toContain('-webkit-text-fill-color: transparent');
    expect(shimmerRule).toContain('animation: flower-model-status-shimmer 2.4s ease-in-out infinite');
    expect(css).toContain('@keyframes flower-model-status-shimmer');
    expect(css).toContain('background-position: -120% 0');
    expect(css).toContain('background-position: 180% 0');
    expect(css).toContain('.flower-model-status-text::after,');
    expect(css).toContain('.flower-model-status-text {\n    color: var(--muted-foreground);');
    expect(css).toContain('.flower-model-status-text::after {\n    content: none !important;');
    expect(indicatorRule).not.toContain('width: 1.65rem');
    expect(indicatorRule).not.toContain('height: 0.82rem');
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

  it('keeps the scroll-to-latest dock control compact and interactive', () => {
    const css = flowerStyles();
    const rowRule = cssRule(css, '.flower-scroll-to-latest-row');
    const buttonRule = cssRule(css, '.flower-scroll-to-latest-button');

    expect(rowRule).toContain('min-height: 2.35rem');
    expect(rowRule).toContain('justify-content: center');
    expect(rowRule).toContain('pointer-events: none');
    expect(buttonRule).toContain('width: 2.1rem');
    expect(buttonRule).toContain('height: 2.1rem');
    expect(buttonRule).toContain('flex: 0 0 2.1rem');
    expect(buttonRule).toContain('cursor: pointer');
    expect(buttonRule).toContain('pointer-events: auto');
    expect(buttonRule).toContain('border-radius: 9999px');
    expect(buttonRule).toContain('transition:');
    expect(css).toContain('.flower-scroll-to-latest-button:hover,');
    expect(css).toContain('.flower-scroll-to-latest-button:focus-visible');
    expect(css).toContain('.flower-scroll-to-latest-button {\n    transition: none;');
  });
});
