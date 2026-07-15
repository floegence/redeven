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
  it('styles expanded terminal activity as a compact read-only terminal panel', () => {
    const css = flowerStyles();
    const panelRule = cssRule(css, '.flower-activity-terminal-panel');
    const headerRule = cssRule(css, '.flower-activity-terminal-header');
    const commandRule = cssRule(css, '.flower-activity-terminal-command');
    const actionRule = cssRule(css, '.flower-activity-terminal-action-button');
    const commandPanelRule = cssRule(css, '.flower-activity-terminal-command-panel');
    const fullCommandRule = cssRule(css, '.flower-activity-terminal-command-full');
    const outputRule = cssRule(css, '.flower-activity-terminal-output');

    expect(panelRule).toContain('--flower-activity-terminal-font');
    expect(panelRule).toContain('background: #0d1117');
    expect(headerRule).toContain('background: #151b23');
    expect(commandRule).toContain('font-family: var(--flower-activity-terminal-font)');
    expect(commandRule).toContain('text-overflow: ellipsis');
    expect(actionRule).toContain('width: 1.75rem');
    expect(actionRule).toContain('height: 1.75rem');
    expect(actionRule).toContain('cursor: pointer');
    expect(commandPanelRule).toContain('background: #10161f');
    expect(fullCommandRule).toContain('white-space: pre-wrap');
    expect(fullCommandRule).toContain('overflow-wrap: anywhere');
    expect(outputRule).toContain('font-family: var(--flower-activity-terminal-font)');
    expect(outputRule).toContain('max-height: 16rem');
    expect(css).toContain('.flower-activity-terminal-command-code');
    expect(css).not.toContain('.flower-activity-terminal-chips');
    expect(css).not.toContain('.flower-activity-terminal-chip');
    expect(css).toContain('.flower-activity-terminal-command-token-command');
    expect(css).toContain('.flower-activity-web-panel,');
    expect(css).toContain('.flower-activity-question-panel,');
    expect(css).toContain('.flower-activity-completion-panel');
  });

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
    const runningButtonRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-button');
    const successButtonRule = cssRule(css, '.flower-activity-inline-row-success .flower-activity-inline-button');
    const failedIconRule = cssRule(css, '.flower-activity-inline-row-error .flower-activity-inline-icon');
    const canceledIconRule = cssRule(css, '.flower-activity-inline-row-canceled .flower-activity-inline-icon');
    const failedStatusRule = cssRule(css, '.flower-activity-inline-status-error');
    const canceledStatusRule = cssRule(css, '.flower-activity-inline-status-canceled');

    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground: #8f99a6');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-strong: #566475');
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
    expect(runningTitleRule).toContain('font-weight: 600');
    expect(runningTitleRule).toContain('text-shadow: 0 0 0.65rem rgba(86, 100, 117, 0.12)');
    expect(runningButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(successButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-complete)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-error: color-mix(in srgb, #f97316 78%, var(--foreground) 22%)');
    expect(failedIconRule).toContain('color: var(--flower-activity-tool-row-error)');
    expect(failedStatusRule).toContain('color: var(--flower-activity-tool-row-error)');
    expect(canceledIconRule).toContain('color: var(--destructive)');
    expect(canceledStatusRule).toContain('color: var(--destructive)');
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

  it('animates activity disclosure against its real content height', () => {
    const css = flowerStyles();
    const disclosureRule = cssRule(css, '.flower-activity-inline-details');
    const clipRule = cssRule(css, '.flower-activity-inline-details-clip');
    const contentRule = cssRule(css, '.flower-activity-inline-details-content');

    expect(disclosureRule).toContain('grid-template-rows: 0fr');
    expect(disclosureRule).toContain('grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1)');
    expect(disclosureRule).not.toContain('max-height:');
    expect(css).toContain(".flower-activity-inline-details[data-state='open'] {");
    expect(css).toContain('grid-template-rows: 1fr;');
    expect(clipRule).toContain('min-height: 0');
    expect(clipRule).toContain('overflow: hidden');
    expect(contentRule).toContain('max-height: min(42rem, 72vh)');
    expect(contentRule).toContain('overflow: auto');
  });

  it('animates only the subagent badge ring when a subagent is running', () => {
    const css = flowerStyles();
    const badgeRule = cssRule(css, '.flower-header-icon-badge');
    const runningRule = cssRule(css, ".flower-header-icon-badge[data-running='true']");
    const ringRule = cssRule(css, ".flower-header-icon-badge[data-running='true']::after");

    expect(badgeRule).not.toContain('animation:');
    expect(runningRule).toContain('overflow: visible');
    expect(ringRule).toContain('border-top-color');
    expect(ringRule).toContain('animation: flower-subagent-badge-ring-spin 920ms linear infinite');
    expect(css).toContain('@keyframes flower-subagent-badge-ring-spin');
    expect(css).toContain(".flower-header-icon-badge[data-running='true']::after {");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".flower-header-icon-badge[data-running='true']::after {\n    animation: none !important;");
  });

  it('uses named layers and dedicated ledger tokens for subagent overlays', () => {
    const css = flowerStyles();
    const shellRule = cssRule(css, '.flower-chat-shell');
    const mainRule = cssRule(css, '.flower-chat-main');
    const headerRule = cssRule(css, '.flower-chat-header');
    const dropdownLayerRule = cssRule(css, '.flower-subagents-dropdown-layer');
    const dropdownRule = cssRule(css, '.flower-subagents-dropdown');
    const indicatorRule = cssRule(css, '.flower-subagent-status-indicator-running');
    const detailGeometryRule = cssRule(css, "[data-floe-geometry-surface='floating-window']:has(> .flower-subagent-detail-window)");
    const detailWindowRule = cssRule(css, '.flower-subagent-detail-window');
    const detailActiveRule = cssRule(css, ".flower-subagent-detail-window[data-floe-floating-window-state='active']");
    const detailOverviewRule = cssRule(css, '.flower-subagent-detail-overview');
    const detailDockRule = cssRule(css, '.flower-subagent-detail-bottom-dock');
    const detailScrollRule = cssRule(css, '.flower-subagent-detail-scroll-to-latest');

    expect(shellRule).toContain('isolation: isolate');
    expect(shellRule).toContain('--flower-layer-chat-main: 0');
    expect(shellRule).toContain('--flower-layer-chat-header: 30');
    expect(shellRule).toContain('--flower-layer-subagent-dropdown: 120');
    expect(shellRule).toContain('--flower-layer-subagent-window: 160');
    expect(mainRule).toContain('z-index: var(--flower-layer-chat-main)');
    expect(headerRule).toContain('z-index: var(--flower-layer-chat-header)');
    expect(dropdownLayerRule).toContain('z-index: var(--flower-layer-subagent-dropdown)');
    expect(dropdownRule).toContain('background: color-mix(in srgb, var(--flower-subagents-panel)');
    expect(dropdownRule).toContain('box-shadow:');
    expect(indicatorRule).toContain('color: color-mix');
    expect(detailGeometryRule).toContain('--flower-subagent-window-shadow-key: rgb(32 42 55 / 24%)');
    expect(detailGeometryRule).toContain('border-radius: 6px');
    expect(detailGeometryRule).toContain('box-shadow:');
    expect(detailGeometryRule).toContain('0 4px 14px -4px var(--flower-subagent-window-shadow-key)');
    expect(css).toContain(".dark [data-floe-geometry-surface='floating-window']:has(> .flower-subagent-detail-window)");
    expect(css).toContain('--flower-subagent-window-shadow-key: rgb(0 0 0 / 68%)');
    expect(css).toContain("> .flower-subagent-detail-window[data-floe-floating-window-state='active']");
    expect(detailWindowRule).toContain('--flower-subagent-window-surface: #fbf9f6');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-band: #f7f4f1');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-raised: #fffdfa');
    expect(detailWindowRule).toContain('--flower-subagent-window-border: #8c857d');
    expect(detailWindowRule).toContain('border: 1px solid var(--flower-subagent-window-border)');
    expect(detailWindowRule).toContain('border-radius: 6px');
    expect(detailWindowRule).toContain('--flower-subagent-window-border:');
    expect(detailWindowRule).toContain('background: var(--flower-subagent-window-surface)');
    expect(detailWindowRule).toContain('0 1px 0 var(--flower-subagent-window-edge-highlight) inset');
    expect(detailWindowRule).not.toContain('0 18px 46px');
    expect(css).toContain('--flower-subagent-window-surface: #343840');
    expect(css).toContain('--flower-subagent-window-surface-band: #393e47');
    expect(css).toContain('--flower-subagent-window-surface-raised: #40454f');
    expect(css).toContain('--flower-subagent-window-border: #757e8a');
    expect(detailActiveRule).toContain('border-color: var(--flower-subagent-window-border-active)');
    expect(detailActiveRule).toContain('inset');
    expect(detailOverviewRule).toContain('background: var(--flower-subagent-window-surface-band)');
    expect(detailDockRule).toContain('border-top:');
    expect(detailDockRule).toContain('align-items: center');
    expect(detailDockRule).toContain('background: var(--flower-subagent-window-surface-band)');
    expect(detailDockRule).not.toContain('space-between');
    expect(detailScrollRule).toContain('position: sticky');
    expect(cssRule(css, '.flower-subagent-detail-bottom-track')).toContain('flex: 1 1 auto');
    expect(cssRule(css, '.flower-subagent-detail-bottom-track')).not.toContain('flex-end');
    expect(css).toContain('.flower-subagent-status-loader');
    expect(css).toContain('.flower-subagent-status-loader .flower-activity-inline-loader-square');
    expect(css).toContain('.flower-subagent-detail-tail-pulse');
    expect(css).toContain('.flower-subagent-ledger-entry-body .flower-activity-inline-row-running .flower-activity-inline-button::before');
    expect(css).not.toContain('z-index: 50');
    expect(detailScrollRule).not.toContain('z-index: ');
    expect(dropdownRule).not.toContain('right: 0');
    expect(css).not.toContain('.flower-subagent-status-dot-running');
  });

  it('keeps subagent window title separate from status metadata', () => {
    const src = fs.readFileSync(new URL('./FlowerSurface.tsx', import.meta.url), 'utf8');

    expect(src).toContain('const subagentDetailWindowTitle = createMemo(() => activeSubagentTitle())');
    expect(src).not.toContain("[activeSubagentTitle(), subagentSummaryStatus()].filter(Boolean).join(' · ')");
  });
});
