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
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector);
  expect(rules.length, `Missing exact CSS rule: ${selector}`).toBeGreaterThan(0);
  return rules.map(match => `${match[1].trim()} {${match[2]}}`).join('\n');
}

describe('Flower activity status presentation', () => {
  it('styles expanded terminal activity as a compact read-only terminal panel', () => {
    const css = flowerStyles();
    const panelRule = cssRule(css, '.flower-activity-terminal-panel');
    const headerRule = cssRule(css, '.flower-activity-terminal-header');
    const commandRule = cssRule(css, '.flower-activity-terminal-command');
    const actionRule = cssRule(css, '.flower-activity-terminal-action-button');
    const expandedCommandRule = cssRule(css, '.flower-activity-terminal-command-expanded');
    const outputRule = cssRule(css, '.flower-activity-terminal-output');

    expect(panelRule).toContain('--flower-activity-terminal-font');
    expect(panelRule).toContain('background: transparent');
    expect(panelRule).not.toContain('gradient');
    expect(panelRule).not.toContain('opacity:');
    expect(headerRule).toContain('background: var(--flower-activity-terminal-command-surface)');
    expect(headerRule).toContain('border: 0');
    expect(commandRule).toContain('font-family: var(--flower-activity-terminal-font)');
    expect(commandRule).toContain('-webkit-line-clamp: 2');
    expect(commandRule).toContain('white-space: pre-wrap');
    expect(commandRule).toContain('overflow-wrap: anywhere');
    expect(actionRule).toContain('width: 1.75rem');
    expect(actionRule).toContain('height: 1.75rem');
    expect(actionRule).toContain('cursor: pointer');
    expect(actionRule).toContain('opacity: 1');
    expect(expandedCommandRule).toContain('-webkit-line-clamp: unset');
    expect(css).not.toContain('.flower-activity-terminal-command-panel');
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
    const iconRule = cssRule(css, '.flower-tool-icon');

    expect(previewRule).toContain('max-height: 15rem');
    expect(previewRule).toContain('overflow: auto');
    expect(linkRule).toContain('cursor: pointer');
    expect(iconRule).toContain('width: 1rem');
    expect(iconRule).toContain('height: 1rem');
  });

  it('uses upstream glyph-only progress without a tool-row background sweep', () => {
    const css = flowerStyles();
    const activityInlineRule = cssRule(css, '.flower-activity-inline');
    const buttonRule = cssRule(css, '.flower-activity-inline-button');
    const buttonHoverRule = cssRule(css, '.flower-activity-inline-button:is(button):hover,\n.flower-activity-inline-button:is(button):focus-visible');
    const iconRule = cssRule(css, '.flower-tool-icon');
    expect(iconRule).toContain('overflow: visible');
    const titleRule = cssRule(css, '.flower-activity-inline-title');
    const titleVerbRule = cssRule(css, '.flower-activity-inline-title-verb');
    const detailRule = cssRule(css, '.flower-activity-inline-detail');
    const durationRule = cssRule(css, '.flower-activity-inline-duration');
    const runningTitleRule = cssRule(css, ".flower-activity-inline-row-running:has([data-floe-progress-shimmer='text']) .flower-activity-inline-title");
    const runningButtonRule = cssRule(css, ".flower-activity-inline-row-running:has([data-floe-progress-shimmer='text']) .flower-activity-inline-button");

    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground: var(--flower-reading-title)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-foreground-strong: var(--foreground)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-quiet: color-mix(in srgb, var(--muted-foreground) 94%, var(--background) 6%)');
    expect(activityInlineRule).toContain('--flower-activity-tool-row-soft: color-mix(in srgb, var(--redeven-chat-muted) 6%, transparent)');
    expect(buttonRule).toContain('position: relative');
    expect(buttonRule).toContain('overflow: hidden');
    expect(buttonRule).toContain('min-height: 2rem');
    expect(buttonRule).toContain('gap: 0.42rem');
    expect(buttonRule).toContain('border-radius: 6px');
    expect(buttonRule).toContain('color: var(--flower-activity-tool-row-quiet)');
    expect(buttonHoverRule).toContain('background: var(--flower-activity-tool-row-soft)');
    expect(buttonHoverRule).not.toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(css).toContain('.flower-activity-inline-button-static');
    expect(css).not.toContain('flower-activity-running-sheen');
    const surface = fs.readFileSync(path.join(repoRoot, 'internal/flower_ui/src/FlowerSurface.tsx'), 'utf8');
    expect(surface).toContain('data-floe-progress-shimmer={livePresentationConfirmed() && displayStatus() === \'running\' ? \'text\' : undefined}');
    expect(css).not.toContain('.flower-activity-inline-row-running .flower-activity-inline-button::before');
    expect(css).not.toContain('.flower-activity-inline-row-waiting .flower-activity-inline-button::before');
    expect(titleRule).toContain('position: relative');
    expect(titleRule).toContain('overflow: hidden');
    expect(titleRule).toContain('color: currentColor');
    expect(titleRule).toContain('font-family: var(--font-sans)');
    expect(titleRule).toContain('font-weight: 400');
    expect(titleVerbRule).toContain('color: currentColor');
    expect(titleVerbRule).toContain('font-weight: inherit');
    expect(detailRule).toContain('color: var(--flower-activity-tool-row-quiet)');
    expect(detailRule).toContain('font-family: var(--font-sans, inherit)');
    expect(durationRule).toContain('color: var(--flower-activity-tool-row-quiet)');
    expect(durationRule).toContain('font-size: 0.6875rem');
    expect(durationRule).toContain('font-weight: 400');
    expect(runningTitleRule).toContain('font-weight: 500');
    expect(runningTitleRule).not.toContain('text-shadow');
    expect(css).not.toContain('flower-activity-title-sweep');
    expect(css).not.toContain('.flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-success .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-error .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-canceled .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-pending .flower-activity-inline-title::after');
    expect(css).not.toContain('.flower-activity-inline-row-waiting .flower-activity-inline-title::after');
    expect(runningButtonRule).toContain('color: var(--flower-activity-tool-row-foreground-strong)');
    expect(css).not.toContain('--flower-activity-tool-row-foreground-complete');
    expect(css).not.toContain('--flower-activity-tool-row-error');
    expect(css).not.toContain('.flower-activity-inline-row-error .flower-activity-inline-icon {');
    expect(css).not.toContain('.flower-activity-inline-row-canceled .flower-activity-inline-icon {');
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
    expect(css).not.toContain("data-layout-motion");
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

  it('replaces the retired badge ring with bounded circular portraits', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'internal/flower_ui/src/styles/subagent-header.css'), 'utf8');
    expect(cssRule(css, '.flower-subagent-header-stack')).toContain('isolation: isolate');
    expect(cssRule(css, '.flower-subagent-header-portrait .flower-subagent-avatar')).toContain('border-radius: 50%');
    expect(css).toContain('filter: grayscale(1)');
    expect(css).toContain('@keyframes flower-subagent-stack-recede');
    expect(css).toContain('@keyframes flower-subagent-stack-replace');
    expect(css).toContain('.flower-subagent-header-stack .flower-subagent-header-portrait { animation: none !important; }');
    expect(flowerStyles()).not.toContain('flower-subagent-badge-ring-spin');
    expect(flowerStyles()).not.toContain('.flower-header-icon-badge');
  });

  it('uses named layers and dedicated window tokens for subagent overlays', () => {
    const css = flowerStyles();
    const shellRule = cssRule(css, '.flower-chat-shell');
    const mainRule = cssRule(css, '.flower-chat-main');
    const headerRule = cssRule(css, '.flower-chat-header');
    const dropdownLayerRule = cssRule(css, '.flower-subagents-dropdown-layer');
    const dropdownRule = cssRule(css, '.flower-subagents-dropdown');
    const dropdownRowRule = cssRule(css, '.flower-subagent-dropdown-row');
    const dropdownRowHoverRule = cssRule(css, '.flower-subagent-dropdown-row:hover');
    const dropdownRunningStatusRule = cssRule(css, '.flower-subagent-dropdown-row-running .flower-subagent-dropdown-status-label');
    const runningTextRule = cssRule(css, '.flower-subagent-dropdown-row-running .flower-subagent-dropdown-name,\n.flower-subagent-status-label-running .flower-subagent-status-text');
    const avatarRule = cssRule(css, '.flower-subagent-avatar');
    const runningIndicatorRule = cssRule(css, '.flower-subagent-status-indicator-running');
    const detailWindowRule = cssRule(css, '.flower-subagent-detail-window');
    const detailActiveRule = cssRule(css, ".flower-subagent-detail-window[data-floe-floating-window-state='active']");
    const detailOverviewRule = cssRule(css, '.flower-subagent-detail-overview');
    const detailAvatarRule = cssRule(css, '.flower-subagent-detail-window .flower-subagent-detail-avatar');
    const runningStatusRule = cssRule(css, '.flower-subagent-status-label-running');
    const detailScrollRule = cssRule(css, '.flower-subagent-detail-scroll-to-latest');

    expect(shellRule).toContain('isolation: isolate');
    expect(shellRule).toContain('--flower-layer-chat-main: 0');
    expect(shellRule).toContain('--flower-layer-chat-header: 30');
    expect(shellRule).toContain('--flower-layer-subagent-dropdown: 120');
    expect(shellRule).toContain('--flower-layer-subagent-window: 160');
    expect(mainRule).toContain('z-index: var(--flower-layer-chat-main)');
    expect(headerRule).toContain('z-index: var(--flower-layer-chat-header)');
    expect(dropdownLayerRule).toContain('z-index: var(--flower-layer-subagent-dropdown)');
    expect(dropdownRule).toContain('background: var(--card)');
    expect(dropdownRule).not.toContain('box-shadow:');
    expect(dropdownRule).not.toContain('backdrop-filter:');
    expect(dropdownRule).toContain('border-radius: 0.875rem');
    expect(dropdownRule).toContain('animation: flower-subagents-dropdown-enter 220ms');
    expect(dropdownRowRule).toContain('min-height: 4rem');
    expect(dropdownRowHoverRule).not.toContain('transform:');
    expect(dropdownRunningStatusRule).toContain('color: var(--primary)');
    expect(css).not.toContain('flower-running-text-shimmer');
    expect(runningTextRule).toContain('color: var(--foreground)');
    expect(runningTextRule).not.toContain('animation:');
    expect(runningTextRule).not.toContain('background-clip:');
    expect(css).toContain('.flower-subagents-dropdown-disclosure');
    expect(css).toContain('.flower-subagents-dropdown-avatar-summary');
    expect(css).not.toContain('.flower-subagents-dropdown-metric');
    expect(avatarRule).toContain('border-radius: 28%');
    expect(avatarRule).toContain('width: 2.25rem');
    expect(avatarRule).toContain('height: 2.25rem');
    expect(avatarRule).not.toContain('animation:');
    expect(runningIndicatorRule).toContain('background: currentColor');
    expect(runningIndicatorRule).not.toContain('animation:');
    expect(css).not.toContain('.flower-subagent-thinking-orb');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface: var(--redeven-chat-surface)');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-soft: color-mix(in srgb, var(--redeven-chat-surface) 92%, var(--background) 8%)');
    expect(detailWindowRule).toContain('--flower-subagent-window-surface-raised: var(--redeven-chat-surface-raised)');
    expect(detailWindowRule).toContain('--flower-subagent-window-border: var(--redeven-stroke-panel)');
    expect(detailWindowRule).toContain('border: 1px solid var(--flower-subagent-window-border)');
    expect(detailWindowRule).toContain('border-radius: 0.875rem');
    expect(detailWindowRule).toContain('--flower-subagent-window-border:');
    expect(detailWindowRule).toContain('background: var(--flower-subagent-window-surface)');
    expect(detailWindowRule).not.toContain('box-shadow:');
    expect(css).not.toContain('--flower-subagent-window-shadow-key');
    expect(detailWindowRule).not.toContain('0 18px 46px');
    expect(detailActiveRule).toContain('border-color: var(--flower-subagent-window-border-active)');
    expect(detailActiveRule).not.toContain('box-shadow:');
    expect(detailOverviewRule).toContain('background: var(--flower-subagent-window-surface-soft)');
    expect(detailAvatarRule).toContain('width: 1.5rem');
    expect(detailAvatarRule).toContain('height: 1.5rem');
    expect(runningStatusRule).toContain('color: var(--foreground)');
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

  it('keeps stable thread avatars separate from the shared status indicator', () => {
    const surface = fs.readFileSync(new URL('./FlowerSurface.tsx', import.meta.url), 'utf8');
    const detail = fs.readFileSync(new URL('./SubagentDetailWindow.tsx', import.meta.url), 'utf8');

    expect(surface).toContain('<SubagentAvatar threadID={item().threadID} />');
    expect(surface).toContain('<span class="flower-subagent-status-indicator flower-subagent-status-indicator-running" aria-hidden="true" />');
    expect(detail).toContain('<SubagentAvatar threadID={props.threadID} class="flower-subagent-detail-avatar" />');
    expect(detail).toContain('{props.statusIndicator}');
    expect(detail).not.toContain('FlowerThinkingOrb');
    expect(detail).not.toContain('data-text=');
  });

  it('shares the compact SubAgent overview between switching and metadata inside narrow windows', () => {
    const css = flowerStyles();
    const overviewRule = cssRule(css, '.flower-subagent-detail-overview');
    const switcherRule = cssRule(css, '.flower-subagent-switcher');
    const metaRule = cssRule(css, '.flower-subagent-detail-overview-meta');

    expect(overviewRule).toContain('align-items: start');
    expect(overviewRule).toContain('display: grid');
    expect(overviewRule).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 21rem)');
    expect(switcherRule).toContain('flex-wrap: wrap');
    expect(switcherRule).not.toContain('border-bottom');
    expect(metaRule).toContain('flex-wrap: nowrap');
    expect(metaRule).toContain('min-height: 2rem');
    expect(css).toContain('@container flower-subagent-window (max-width: 560px)');
    expect(css).not.toContain('.flower-subagent-detail-agent-type');
  });
});
