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
    const activityInlineRule = cssRule(css, '.flower-activity-inline');
    const buttonRule = cssRule(css, '.flower-activity-inline-button');
    const buttonHoverRule = cssRule(css, '.flower-activity-inline-button:not(:disabled):hover,\n.flower-activity-inline-button:not(:disabled):focus-visible');
    const sheenRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-button::before');
    const loaderRule = cssRule(css, '.flower-activity-inline-loader');
    const loaderSquareRule = cssRule(css, '.flower-activity-inline-loader-square');
    const titleRule = cssRule(css, '.flower-activity-inline-title');
    const titleVerbRule = cssRule(css, '.flower-activity-inline-title-verb');
    const detailRule = cssRule(css, '.flower-activity-inline-detail');
    const statusRule = cssRule(css, '.flower-activity-inline-duration,\n.flower-activity-inline-status');
    const runningTitleRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-title');
    const successButtonRule = cssRule(css, '.flower-activity-inline-row-success .flower-activity-inline-button');

    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground: #8f99a6');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-strong: #6f7a89');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-complete: #9ba5b1');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-soft: rgba(126, 138, 153, 0.11)');
    expect(buttonRule).toContain('position: relative');
    expect(buttonRule).toContain('overflow: hidden');
    expect(buttonRule).toContain('min-height: 1.75rem');
    expect(buttonRule).toContain('gap: 0.42rem');
    expect(buttonRule).toContain('border-radius: 6px');
    expect(buttonRule).toContain('color: var(--flower-activity-tool-row-foreground)');
    expect(buttonHoverRule).toContain('background: var(--flower-activity-tool-row-soft)');
    expect(buttonHoverRule).not.toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(sheenRule).toContain('linear-gradient(\n      100deg');
    expect(sheenRule).toContain('width: 18%');
    expect(sheenRule).toContain('rgba(145, 155, 168, 0.12) 38%');
    expect(sheenRule).toContain('rgba(255, 255, 255, 0.72) 50%');
    expect(sheenRule).toContain('opacity: 0.64');
    expect(sheenRule).toContain('animation: flower-activity-running-sheen 5.4s cubic-bezier(0.42, 0, 0.2, 1) infinite');
    expect(titleRule).toContain('color: currentColor');
    expect(titleRule).toContain('font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace');
    expect(titleRule).toContain('font-weight: 560');
    expect(titleVerbRule).toContain('color: currentColor');
    expect(titleVerbRule).toContain('font-weight: inherit');
    expect(detailRule).toContain('color: currentColor');
    expect(detailRule).toContain('font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace');
    expect(statusRule).toContain('color: currentColor');
    expect(statusRule).toContain('font-size: 0.6875rem');
    expect(statusRule).toContain('font-weight: 620');
    expect(runningTitleRule).toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(runningTitleRule).toContain('font-weight: 600');
    expect(runningTitleRule).toContain('text-shadow: 0 0 0.7rem rgba(127, 137, 151, 0.10)');
    expect(successButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-complete)');
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
