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
    expect(panelRule).toContain('background: var(--redeven-chat-output)');
    expect(headerRule).toContain('background: var(--redeven-code-chrome)');
    expect(commandRule).toContain('font-family: var(--flower-activity-terminal-font)');
    expect(commandRule).toContain('text-overflow: ellipsis');
    expect(actionRule).toContain('width: 1.75rem');
    expect(actionRule).toContain('height: 1.75rem');
    expect(actionRule).toContain('cursor: pointer');
    expect(commandPanelRule).toContain('background: var(--redeven-code-surface)');
    expect(fullCommandRule).toContain('white-space: pre-wrap');
    expect(fullCommandRule).toContain('overflow-wrap: anywhere');
    expect(outputRule).toContain('font-family: var(--flower-activity-terminal-font)');
    expect(outputRule).toContain('font-size: 0.71875rem');
    expect(outputRule).toContain('line-height: 1.5');
    expect(outputRule).toContain('padding: 0.625rem');
    expect(outputRule).toContain('box-sizing: border-box');
    expect(outputRule).toContain('max-height: 6.640625rem');
    expect(css).toContain('.flower-activity-terminal-command-code');
    expect(css).not.toContain('.flower-activity-terminal-chips');
    expect(css).not.toContain('.flower-activity-terminal-chip');
    expect(css).toContain('.flower-activity-terminal-command-token-command');
    expect(css).toContain('.flower-activity-web-panel,');
    expect(css).toContain('.flower-activity-question-panel {');
    expect(css).not.toContain('.flower-activity-completion-panel');
  });

  it('bounds Web Fetch previews and keeps external-link controls interactive', () => {
    const css = flowerStyles();
    const previewRule = cssRule(css, '.flower-activity-web-fetch-preview');
    const linkRule = cssRule(css, '.flower-activity-web-fetch-open');
    const iconRule = cssRule(css, '.flower-activity-web-fetch-searching-orb');

    expect(previewRule).toContain('max-height: 15rem');
    expect(previewRule).toContain('overflow: auto');
    expect(linkRule).toContain('cursor: pointer');
    expect(iconRule).toContain('width: 1.25rem');
    expect(iconRule).toContain('height: 1.25rem');
  });

  it('keeps the running sweep inside the title without restoring a row overlay', () => {
    const css = flowerStyles();
    const activityInlineRule = cssRule(css, '.flower-activity-inline');
    const buttonRule = cssRule(css, '.flower-activity-inline-button');
    const buttonHoverRule = cssRule(css, '.flower-activity-inline-button:is(button):hover,\n.flower-activity-inline-button:is(button):focus-visible');
    const loaderRule = cssRule(css, '.flower-activity-inline-loader');
    const loaderSquareRule = cssRule(css, '.flower-activity-inline-loader-square');
    const titleRule = cssRule(css, '.flower-activity-inline-title');
    const titleVerbRule = cssRule(css, '.flower-activity-inline-title-verb');
    const detailRule = cssRule(css, '.flower-activity-inline-detail');
    const durationRule = cssRule(css, '.flower-activity-inline-duration');
    const runningTitleRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-title');
    const runningTitleSweepRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-title::after');
    const runningButtonRule = cssRule(css, '.flower-activity-inline-row-running .flower-activity-inline-button');
    const successButtonRule = cssRule(css, '.flower-activity-inline-row-success .flower-activity-inline-button');
    const failedIconRule = cssRule(css, '.flower-activity-inline-row-error .flower-activity-inline-icon');
    const canceledIconRule = cssRule(css, '.flower-activity-inline-row-canceled .flower-activity-inline-icon');

    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground: var(--redeven-chat-muted)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-strong: color-mix(in srgb, var(--redeven-chat-text) 72%, var(--redeven-chat-muted) 28%)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-complete: color-mix(in srgb, var(--redeven-chat-muted) 84%, var(--redeven-chat-text) 16%)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-soft: color-mix(in srgb, var(--redeven-chat-muted) 11%, transparent)');
    expect(buttonRule).toContain('position: relative');
    expect(buttonRule).toContain('overflow: hidden');
    expect(buttonRule).toContain('min-height: 1.75rem');
    expect(buttonRule).toContain('gap: 0.42rem');
    expect(buttonRule).toContain('border-radius: 6px');
    expect(buttonRule).toContain('color: var(--flower-activity-tool-row-foreground)');
    expect(buttonHoverRule).toContain('background: var(--flower-activity-tool-row-soft)');
    expect(buttonHoverRule).not.toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(css).toContain('.flower-activity-inline-button-static');
    expect(css).not.toContain('flower-activity-running-sheen');
    expect(css).not.toContain('.flower-activity-inline-row-running .flower-activity-inline-button::before');
    expect(css).not.toContain('.flower-activity-inline-row-waiting .flower-activity-inline-button::before');
    expect(titleRule).toContain('position: relative');
    expect(titleRule).toContain('overflow: hidden');
    expect(titleRule).toContain('color: currentColor');
    expect(titleRule).toContain('font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace');
    expect(titleRule).toContain('font-weight: 560');
    expect(titleVerbRule).toContain('color: currentColor');
    expect(titleVerbRule).toContain('font-weight: inherit');
    expect(detailRule).toContain('color: currentColor');
    expect(detailRule).toContain('font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace');
    expect(durationRule).toContain('color: currentColor');
    expect(durationRule).toContain('font-size: 0.6875rem');
    expect(durationRule).toContain('font-weight: 620');
    expect(runningTitleRule).toContain('font-weight: 600');
    expect(runningTitleRule).not.toContain('text-shadow');
    expect(runningTitleSweepRule).toContain('position: absolute');
    expect(runningTitleSweepRule).toContain('inset: 0');
    expect(runningTitleSweepRule).toContain('background-size: 250% 100%');
    expect(runningTitleSweepRule).toContain('color-mix(in srgb, var(--flower-chat-surface) 60%, transparent)');
    expect(runningTitleSweepRule).toContain('pointer-events: none');
    expect(runningTitleSweepRule).toContain('animation: flower-activity-title-sweep 2.6s ease-out infinite');
    expect(runningTitleSweepRule).not.toContain('left:');
    expect(css).toContain('@keyframes flower-activity-title-sweep');
    expect(css).toContain('90%,\n  100% {\n    background-position: 0 0;\n  }');
    expect(css).not.toContain('.flower-activity-inline-row-success .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-error .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-canceled .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-pending .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-waiting .flower-activity-inline-title::after');
    expect(css).toContain(".flower-activity-inline-row-running .flower-activity-inline-title::after {\n    content: none !important;");
    expect(css).toContain("@media (forced-colors: active) {\n  .flower-activity-inline-row-running .flower-activity-inline-title::after {\n    content: none;");
    expect(runningButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(successButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-complete)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-error: var(--redeven-status-error-foreground)');
    expect(failedIconRule).toContain('color: var(--flower-activity-tool-row-error)');
    expect(canceledIconRule).toContain('color: var(--destructive)');
    expect(css).toContain('@keyframes flower-activity-loader-square');
    expect(loaderRule).toContain('grid-template-columns: repeat(2, 0.3rem)');
    expect(loaderSquareRule).toContain('animation: flower-activity-loader-square 1.35s ease-in-out infinite');
    expect(css).toContain('.flower-activity-inline-loader-square {');
    expect(css).not.toContain('.flower-activity-inline-details::before');
    expect(css).not.toContain('.flower-activity-inline-row-running::before');
  });

  it('animates activity disclosure against its real content height', () => {
    const css = flowerStyles();
    const disclosureRule = cssRule(css, '.flower-activity-inline-details');
    const clipRule = cssRule(css, '.flower-activity-inline-details-clip');
    const contentRule = cssRule(css, '.flower-activity-inline-details-content');
    const terminalContentRule = cssRule(css, '.flower-activity-inline-details-content-terminal');

    expect(disclosureRule).toContain('height: 0');
    expect(disclosureRule).toContain('overflow: hidden');
    expect(disclosureRule).not.toContain('transition:');
    expect(disclosureRule).not.toContain('max-height:');
    expect(css).toContain(".flower-activity-inline-details[data-state='opening'],");
    expect(css).toContain(".flower-activity-inline-details[data-layout-motion='resizing'] {");
    expect(css).toContain('will-change: height, opacity, transform');
    expect(clipRule).toContain('min-height: 0');
    expect(contentRule).toContain('box-sizing: border-box');
    expect(contentRule).toContain('max-height: min(42rem, 72vh)');
    expect(contentRule).toContain('overflow: auto');
    expect(contentRule).not.toContain('content-visibility');
    expect(contentRule).not.toContain('contain-intrinsic-size');
    expect(contentRule).toContain('border-left: 1px solid');
    expect(contentRule).toContain('padding: 0.125rem 0 0.25rem 0.625rem');
    expect(terminalContentRule).toContain('border-left: 0');
    expect(terminalContentRule).toContain('padding-left: 0');
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
    const dropdownRowRule = cssRule(css, '.flower-subagent-dropdown-row');
    const dropdownRowHoverRule = cssRule(css, '.flower-subagent-dropdown-row:hover');
    const dropdownRunningNameRule = cssRule(css, '.flower-subagent-dropdown-row-running .flower-subagent-dropdown-name');
    const dropdownRunningStatusRule = cssRule(css, '.flower-subagent-dropdown-row-running .flower-subagent-dropdown-status-label');
    const runningTextRule = cssRule(css, '.flower-subagent-dropdown-row-running .flower-subagent-dropdown-name,\n.flower-subagent-status-label-running .flower-subagent-status-text');
    const thinkingOrbRule = cssRule(css, '.flower-subagent-thinking-orb');
    const detailGeometryRule = cssRule(css, "[data-floe-geometry-surface='floating-window']:has(> .flower-subagent-detail-window)");
    const detailWindowRule = cssRule(css, '.flower-subagent-detail-window');
    const detailActiveRule = cssRule(css, ".flower-subagent-detail-window[data-floe-floating-window-state='active']");
    const detailOverviewRule = cssRule(css, '.flower-subagent-detail-overview');
    const detailSignalRule = cssRule(css, '.flower-subagent-detail-signal');
    const runningStatusRule = cssRule(css, '.flower-subagent-status-label-running');
    const runningStatusToneRule = cssRule(css, '.flower-subagent-status-label-running .flower-subagent-status-text');
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
    expect(dropdownRule).toContain('border-radius: 0.5rem');
    expect(dropdownRule).toContain('animation: flower-subagents-dropdown-enter 120ms');
    expect(dropdownRowRule).toContain('min-height: 3.875rem');
    expect(dropdownRowHoverRule).not.toContain('transform:');
    expect(dropdownRunningNameRule).toContain('--flower-subagent-running-text-base: color-mix(in srgb, var(--foreground) 68%, var(--flower-subagents-panel) 32%)');
    expect(dropdownRunningNameRule).toContain('--flower-subagent-running-text-highlight: color-mix(in srgb, var(--flower-subagents-active) 52%, var(--foreground) 48%)');
    expect(dropdownRunningNameRule).toContain('--flower-subagent-running-text-peak: var(--foreground)');
    expect(dropdownRunningStatusRule).toContain('color: var(--primary)');
    expect(runningTextRule).toContain('background-clip: text');
    expect(runningTextRule).toContain('var(--flower-subagent-running-text-highlight) 44%');
    expect(runningTextRule).toContain('var(--flower-subagent-running-text-peak) 50%');
    expect(runningTextRule).toContain('var(--flower-subagent-running-text-highlight) 56%');
    expect(runningTextRule).toContain('animation: flower-activity-title-sweep 2.6s ease-out infinite');
    expect(css).not.toContain('flower-running-text-shimmer');
    expect(css).toContain(".flower-subagents-dropdown-metric[data-tone='completed']");
    expect(css).toContain('.flower-subagents-dropdown-group-header');
    expect(css).not.toContain('.flower-subagent-status-indicator-running');
    expect(thinkingOrbRule).toContain('width: 1.25rem');
    expect(thinkingOrbRule).toContain('height: 1.25rem');
    expect(detailGeometryRule).toContain('--flower-subagent-window-shadow-key: color-mix(in srgb, var(--redeven-shadow-color) 72%, transparent)');
    expect(detailGeometryRule).toContain('border-radius: 6px');
    expect(detailGeometryRule).toContain('box-shadow:');
    expect(detailGeometryRule).toContain('0 4px 14px -4px var(--flower-subagent-window-shadow-key)');
    expect(css).toContain("> .flower-subagent-detail-window[data-floe-floating-window-state='active']");
    expect(detailWindowRule).toContain('--flower-subagent-window-surface: var(--redeven-chat-surface)');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-band: var(--redeven-code-chrome)');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-raised: var(--redeven-chat-surface-raised)');
    expect(detailWindowRule).toContain('--flower-subagent-window-border: color-mix(in srgb, var(--redeven-chat-border) 55%, var(--foreground) 45%)');
    expect(detailWindowRule).toContain('border: 1px solid var(--flower-subagent-window-border)');
    expect(detailWindowRule).toContain('border-radius: 6px');
    expect(detailWindowRule).toContain('--flower-subagent-window-border:');
    expect(detailWindowRule).toContain('background: var(--flower-subagent-window-surface)');
    expect(detailWindowRule).toContain('0 1px 0 var(--flower-subagent-window-edge-highlight) inset');
    expect(detailWindowRule).not.toContain('0 18px 46px');
    expect(detailActiveRule).toContain('border-color: var(--flower-subagent-window-border-active)');
    expect(detailActiveRule).toContain('inset');
    expect(detailOverviewRule).toContain('background: var(--flower-subagent-window-surface-band)');
    expect(detailSignalRule).toContain('border-radius: 9999px');
    expect(runningStatusRule).toContain('color: var(--primary)');
    expect(runningStatusToneRule).toContain('--flower-subagent-running-text-base: color-mix(in srgb, var(--primary) 68%, var(--flower-subagent-window-surface-band) 32%)');
    expect(runningStatusToneRule).toContain('--flower-subagent-running-text-highlight: color-mix(in srgb, var(--flower-subagent-window-accent) 52%, var(--flower-subagent-window-text) 48%)');
    expect(runningStatusToneRule).toContain('--flower-subagent-running-text-peak: var(--flower-subagent-window-text)');
    expect(detailScrollRule).toContain('position: sticky');
    expect(css).not.toContain('.flower-subagent-detail-bottom-dock');
    expect(css).not.toContain('.flower-subagent-detail-bottom-track');
    expect(css).not.toContain('.flower-subagent-status-loader');
    expect(css).toContain('.flower-subagent-dropdown-row-running .flower-subagent-dropdown-name,\n  .flower-subagent-status-label-running .flower-subagent-status-text {\n    animation: none !important;');
    expect(css).not.toContain('.flower-subagent-detail-tail-pulse');
    expect(css).not.toContain('.flower-subagent-ledger-entry-body .flower-activity-inline-row-running .flower-activity-inline-button {');
    expect(css).not.toContain('.flower-subagent-ledger-entry-body .flower-activity-inline-row-running .flower-activity-inline-button::before');
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

  it('uses the Thinking Orbs composing state for running subagents without duplicating it in detail metadata', () => {
    const surface = fs.readFileSync(new URL('./FlowerSurface.tsx', import.meta.url), 'utf8');
    const detail = fs.readFileSync(new URL('./SubagentDetailWindow.tsx', import.meta.url), 'utf8');
    const orb = fs.readFileSync(new URL('./FlowerThinkingOrb.tsx', import.meta.url), 'utf8');

    expect(orb).toContain("export const FLOWER_THINKING_ORB_STATE = 'composing'");
    expect(surface).toContain('<FlowerThinkingOrb class="flower-subagent-thinking-orb" running />');
    expect(detail).toContain('<FlowerThinkingOrb class="flower-subagent-detail-thinking-orb" running />');
    expect(detail).toContain("when={props.status === 'running'}");
    expect(detail).toContain('fallback={<Bot class="h-4 w-4" />}');
    expect(detail).not.toContain('data-text=');
    expect(detail).toContain("<Show when={props.status !== 'running'}>{props.statusIndicator}</Show>");
  });
});
