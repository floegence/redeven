import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readRedevenCss(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, './redeven.css'), 'utf8');
}

function readEnvAppEntryCss(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, '../index.css'), 'utf8');
}

function readFlowerSettingsSource(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, '../ui/pages/settings/sections/FlowerSection.tsx'), 'utf8');
}

describe('Redeven Env App surface theme contract', () => {
  it('uses one quiet Git divider role across themes', () => {
    const src = readRedevenCss();
    expect(src).toContain('--git-table-gridline: var(--redeven-stroke-divider);');
    expect(src).toContain('border-color: var(--git-table-gridline) !important;');
    expect(src).not.toContain('--git-table-gridline: color-mix');
  });

  it('scopes desktop theme transition suppression to shell chrome instead of the full Workbench tree', () => {
    const src = readEnvAppEntryCss();

    expect(src).toContain("html[data-redeven-theme-switching='true'] [data-floe-shell-slot='top-bar']");
    expect(src).toContain("html[data-redeven-theme-switching='true'] [data-floe-shell-slot='activity-bar']");
    expect(src).toContain("html[data-redeven-theme-switching='true'] [data-floe-shell-slot='sidebar']");
    expect(src).toContain("html[data-redeven-theme-switching='true'] [data-floe-shell-slot='bottom-bar']");
    expect(src).not.toContain("html[data-theme-switching='true'] *");
    expect(src).not.toContain("html[data-redeven-theme-switching='true'] *");
    expect(src).not.toContain("html[data-redeven-theme-switching='true'] .workbench");
  });

  it('keeps published shell colors authoritative and control boundaries independent', () => {
    const src = readRedevenCss();
    for (const token of ['background', 'foreground', 'primary', 'card', 'popover', 'input', 'ring']) {
      expect(src).not.toMatch(new RegExp('--' + token + ':\\s*#[0-9a-f]', 'i'));
    }
    expect(src).toContain('--redeven-surface-main: var(--background);');
    expect(src).toContain('--redeven-surface-panel: var(--card);');
    expect(src).toContain('--redeven-stroke-control: var(--input);');
    expect(src).toContain('--redeven-stroke-control-strong: var(--ring);');
    expect(src).toContain('--redeven-stroke-overlay: color-mix(in srgb, var(--foreground) 11.5%, var(--redeven-surface-overlay));');
    expect(src).toContain('--redeven-stroke-divider: color-mix(in srgb, var(--foreground) 8.5%, var(--redeven-surface-panel));');
  });

  it('keeps the main content surface separate from shell chrome while pairing its Classic Dark strokes', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-surface-main {');
    expect(src).toContain('background: var(--redeven-surface-main) !important;');
    expect(src).toContain('.redeven-file-preview-surface-window {');
    expect(src).toContain('background: var(--floe-window-background) !important;');
    expect(src).toContain('background: var(--floe-window-titlebar-background);');
    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-main);');
    expect(src).toContain('--redeven-workbench-default-body-surface: var(--redeven-surface-main);');
    expect(src).not.toContain('--background: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--muted: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).toContain('--redeven-stroke-control: var(--input);');
    expect(src).not.toContain('--sidebar: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--activity-bar: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).toContain('--redeven-surface-panel: var(--card);');
    expect(src).toContain('--redeven-surface-overlay: var(--popover, var(--card));');
  });

  it('derives one settings hierarchy for every shell theme without Classic-only copies', () => {
    const src = readRedevenCss();
    const sharedRootStart = src.indexOf(':root {\n  /* Canonical semantic aliases.');
    const sharedRootEnd = src.indexOf('\n}\n\n:root.dark {', sharedRootStart);
    const sharedRoot = src.slice(sharedRootStart, sharedRootEnd);
    const classicLightStart = src.indexOf(":root[data-floe-shell-theme='classic-light'],");
    const classicLightEnd = src.indexOf('\n}\n\n:root {', classicLightStart);
    const classicLightScope = src.slice(classicLightStart, classicLightEnd);
    const classicDarkStart = src.indexOf(":root[data-floe-shell-theme='classic-dark'],");
    const classicDarkEnd = src.indexOf('\n}\n\n:root[data-floe-shell-theme=\'hc-light\']', classicDarkStart);
    const classicDarkScope = src.slice(classicDarkStart, classicDarkEnd);

    for (const token of [
      '--redeven-settings-selection-source: var(--ring, var(--primary));',
      '--redeven-settings-contrast-source: var(--redeven-surface-shadow-source);',
      '--redeven-settings-header-bg: var(--redeven-surface-panel);',
      '--redeven-settings-sidebar-bg: color-mix(in srgb, var(--sidebar) 82%, var(--redeven-surface-main) 18%);',
      '--redeven-settings-sidebar-border: color-mix(in srgb, var(--foreground) 14%, var(--redeven-settings-sidebar-bg));',
      '--redeven-settings-content-bg: var(--redeven-surface-main);',
      '--redeven-settings-panel-bg: var(--redeven-surface-panel);',
      '--redeven-settings-sidebar-inset-bg: color-mix(in srgb, var(--redeven-surface-control-muted) 76%, var(--redeven-settings-sidebar-bg) 24%);',
      '--redeven-settings-sidebar-hover-bg: color-mix(in srgb, var(--foreground) 6%, var(--redeven-settings-sidebar-bg));',
      '--redeven-settings-sidebar-selection-bg: color-mix(in srgb, var(--redeven-settings-selection-source) 18%, var(--redeven-settings-sidebar-bg));',
      '--redeven-settings-sidebar-selection-fg: color-mix(in srgb, var(--foreground) 78%, var(--redeven-settings-contrast-source) 22%);',
      '--redeven-settings-sidebar-selection-indicator: color-mix(in srgb, var(--ring) 82%, var(--foreground) 18%);',
      '--redeven-settings-sidebar-note-fg: var(--muted-foreground);',
      '--redeven-settings-sidebar-control-border: color-mix(in srgb, var(--foreground) 24%, var(--redeven-settings-sidebar-inset-bg));',
      '--redeven-settings-inset-bg: color-mix(in srgb, var(--redeven-surface-control-muted) 82%, var(--redeven-settings-panel-bg) 18%);',
      '--redeven-settings-row-hover-bg: color-mix(in srgb, var(--foreground) 6%, var(--redeven-settings-inset-bg));',
      '--redeven-settings-inset-border: color-mix(in srgb, var(--foreground) 14%, var(--redeven-settings-inset-bg));',
      '--redeven-settings-divider: color-mix(in srgb, var(--foreground) 6%, var(--redeven-settings-inset-bg));',
      '--redeven-settings-label-fg: color-mix(in srgb, var(--foreground) 78%, var(--muted-foreground) 22%);',
      '--redeven-settings-note-fg: var(--muted-foreground);',
      '--redeven-settings-selection-bg: color-mix(in srgb, var(--redeven-settings-selection-source) 18%, var(--redeven-settings-panel-bg));',
      '--redeven-settings-selection-fg: color-mix(in srgb, var(--foreground) 78%, var(--redeven-settings-contrast-source) 22%);',
      '--redeven-settings-choice-selected-bg: color-mix(in srgb, var(--redeven-settings-selection-source) 8%, var(--redeven-settings-inset-bg));',
      '--redeven-settings-choice-selected-border: var(--redeven-settings-selection-indicator);',
      '--redeven-settings-control-border: color-mix(in srgb, var(--foreground) 24%, var(--redeven-settings-inset-bg));',
    ]) {
      expect(sharedRoot).toContain(token);
    }

    expect(classicLightScope).not.toContain('--redeven-settings-');
    expect(classicDarkScope).not.toContain('--redeven-settings-');
    expect(src).toContain('--redeven-settings-contrast-source: var(--redeven-surface-highlight-source);');
    expect(src).toContain('.redeven-settings-table {');
    expect(src).toContain('background: var(--redeven-settings-inset-bg);');
    expect(src).toContain('.redeven-settings-list > .redeven-setting-row + .redeven-setting-row {');
    expect(src).toContain('.redeven-settings-nav-item--active,');
    expect(src).toContain('.redeven-settings-sidebar-note {');
    expect(src).toContain(':root:not(.dark) .redeven-settings-sidebar-group-label,');
    expect(src).toContain('border-color: var(--redeven-settings-sidebar-control-border);');
    expect(src).toContain('background: var(--redeven-settings-sidebar-inset-bg);');
    expect(src).toContain('background: var(--redeven-settings-sidebar-hover-bg) !important;');
    expect(src).toContain('background: var(--redeven-settings-sidebar-selection-bg) !important;');
    expect(src).toContain('color: var(--redeven-settings-sidebar-selection-fg) !important;');
    expect(src).toContain('.redeven-settings-nav-item--active::before {');
    expect(src).toContain('inset-inline-start: 0.25rem;');
    expect(src).toContain('width: 3px;');
    expect(src).toContain(":not([type='range']):not(.redeven-settings-search),");
    expect(src).toContain('.redeven-settings-section {');
    expect(src).toContain('border: 0;');
    expect(src).toContain('background: transparent;');
    expect(src).not.toContain('--redeven-settings-section-shadow:');
    expect(src).not.toContain('--redeven-settings-card-border:');
    expect(src).not.toContain('--redeven-settings-card-bg:');
  });

  it('uses neutral selection surfaces for large Flower choices without weakening focused settings selection', () => {
    const css = readRedevenCss();
    const flower = readFlowerSettingsSource();

    expect(css).toContain('.redeven-settings-choice--selected-neutral,');
    expect(css).toContain('border-color: var(--redeven-settings-choice-selected-border) !important;');
    expect(css).toContain('background: var(--redeven-settings-choice-selected-bg) !important;');
    expect(css).toContain('background: var(--redeven-settings-selection-bg) !important;');
    expect(flower.match(/redeven-settings-choice--selected-neutral/g)).toHaveLength(3);
    expect(flower).not.toContain("&& 'redeven-settings-choice--selected'");
  });

  it('keeps high-contrast settings explicit without adding another ordinary-theme mapping', () => {
    const src = readRedevenCss();
    const highContrastStart = src.indexOf(":root[data-floe-shell-theme='hc-light'] {");
    const highContrastEnd = src.indexOf('\n}\n\n@media (max-width: 960px)', highContrastStart);
    const highContrastScope = src.slice(highContrastStart, highContrastEnd);
    const forcedColorsStart = src.indexOf('@media (forced-colors: active) {', src.indexOf('.redeven-settings-table__row--interactive:hover'));
    const forcedColorsEnd = src.indexOf('\n}\n\n.redeven-settings-alert--danger', forcedColorsStart);
    const forcedColorsScope = src.slice(forcedColorsStart, forcedColorsEnd);

    expect(highContrastScope).toContain('--redeven-settings-inset-border: var(--border);');
    expect(highContrastScope).toContain('--redeven-settings-divider: var(--border);');
    expect(highContrastScope).toContain('--redeven-settings-sidebar-selection-bg: var(--selection-bg);');
    expect(highContrastScope).toContain('--redeven-settings-sidebar-selection-fg: var(--selection-fg);');
    expect(src).toContain(":root[data-floe-shell-theme='hc-light'] .redeven-settings-section {");
    expect(src).toContain('border: 1px solid var(--redeven-settings-inset-border);');
    expect(forcedColorsScope).toContain('border-color: CanvasText !important;');
    expect(forcedColorsScope).toContain('border: 1px solid CanvasText !important;');
    expect(forcedColorsScope).toContain('background: Canvas !important;');
    expect(forcedColorsScope).toContain('background: Highlight !important;');
    expect(forcedColorsScope).toContain('color: HighlightText !important;');
  });

  it('keeps Flower on the shared main content surface family instead of private raw color literals', () => {
    const src = readRedevenCss();

    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-main);');
    expect(src).toContain('--flower-chat-surface-soft: var(--redeven-surface-panel-soft);');
    expect(src).toContain('--flower-chat-surface-elevated: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--flower-chat-surface-border: var(--redeven-surface-panel-border);');
    expect(src).not.toContain('--flower-chat-surface: #f7f4f1;');
    expect(src).not.toContain('--flower-chat-surface: rgb(41, 44, 51);');
    expect(src.match(/--redeven-surface-panel: #f7f4f1;/g)?.length ?? 0).toBe(0);
    expect(src.match(/rgb\(41, 44, 51\)/g)?.length ?? 0).toBe(0);
  });

  it('owns shared product colors through semantic aliases and keeps chat shells theme-aware', () => {
    const src = readRedevenCss();

    for (const token of [
      '--redeven-shadow-color:',
      '--redeven-status-info:',
      '--redeven-status-success:',
      '--redeven-status-warning:',
      '--redeven-status-error:',
      '--redeven-code-surface:',
      '--redeven-code-chrome:',
      '--redeven-code-token-command:',
      '--redeven-chat-surface:',
      '--redeven-chat-border:',
      '--redeven-categorical-8:',
    ]) {
      expect(src).toContain(token);
    }

    const chatShellStart = src.indexOf('/* Shell block: command highlighting + collapsed output interaction. */');
    const chatShellEnd = src.indexOf('.chat-structured-receipt {', chatShellStart);
    const chatShell = src.slice(chatShellStart, chatShellEnd);
    expect(chatShell).toContain('var(--redeven-chat-surface-raised)');
    expect(chatShell).toContain('var(--redeven-code-token-command)');
    expect(chatShell).not.toMatch(/#(?:0d1117|0f141b|161b22|2d333b|30363d|58a6ff|3fb950|f85149|e6edf3|8b949e)\b/i);
  });

  it('leaves brand icon styles with their shared component owner', () => {
    const src = readRedevenCss();
    expect(src).not.toContain('.redeven-flower-soft-aura');
  });

  it('retains compact Workbench brand sizing without glow', () => {
    const src = fs.readFileSync(new URL('../../../../flower_ui/src/icons/flower-icon.css', import.meta.url), 'utf8');
    expect(src).toContain('.redeven-flower-soft-aura-workbench-svg');
    expect(src).toContain('width: 84%');
    expect(src).not.toMatch(/blur|animation|box-shadow/);
  });

  it('keeps the terminal surface focus state free of an outer halo ring', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-terminal-surface:focus,');
    expect(src).toContain('.redeven-terminal-surface:focus-visible {');
    expect(src).toContain('box-shadow: none !important;');
    expect(src).not.toContain('0 0 0 2px color-mix(in srgb, var(--ring) 72%, transparent)');
  });

  it('keeps workbench layout interaction visuals lightweight', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-terminal-surface {');
    expect(src).toContain('contain: paint;');
    expect(src).not.toContain('redeven-terminal-freeze-snapshot');
    expect(src).not.toContain("data-redeven-terminal-freeze");
    expect(src).toContain(".redeven-workbench-page[data-redeven-workbench-layout-interacting='true'] .workbench-widget {");
    expect(src).toContain('scale 120ms ease-out');
    expect(src).toContain(".workbench-widget[data-redeven-workbench-widget-closing='true'] {");
    expect(src).toContain('scale: 0.985;');
    expect(src).not.toContain('redeven-terminal-work-indicator');
    expect(src).toContain('transition: none !important;');
  });

  it('keeps Workbench render transactions scoped to the projected canvas layer', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-workbench-page .workbench-surface {');
    expect(src).toContain('contain: layout paint;');
    expect(src).toContain('.redeven-workbench-page[data-redeven-workbench-render-transaction] .workbench-canvas__projected-layer {');
    expect(src).toContain('display: none !important;');
    expect(src).not.toContain("html[data-redeven-theme-switching='true'] .workbench-canvas__projected-layer");
    expect(src).not.toContain(".redeven-workbench-page[data-redeven-workbench-render-transaction] .workbench-surface {");
  });

  it('replaces the Workbench entry expansion animation with a lightweight progress curtain', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-loading-curtain {');
    expect(src).toContain('.redeven-loading-curtain__indicator {');
    expect(src).toContain('height: 3px;');
    expect(src).toContain('.redeven-loading-curtain__indicator-bar {');
    expect(src).toContain('background: var(--muted-foreground);');
    expect(src).toContain('animation: redeven-loading-curtain-sweep 1.35s cubic-bezier(0.42, 0, 0.2, 1) infinite;');
    expect(src).toContain('@keyframes redeven-loading-curtain-sweep {');
    expect(src).toContain('.redeven-loading-curtain__message {');
    expect(src).toContain('.git-content-skeleton {');
    expect(src).toContain('.git-content-skeleton__block::after {');
    expect(src).toContain(".git-content-skeleton[data-git-skeleton-busy='false'] .git-content-skeleton__block::after {");
    expect(src).toContain('.git-content-skeleton__graph-row {');
    expect(src).toContain('.git-content-skeleton__table-row {');
    expect(src).toContain('.git-content-skeleton__patch {');
    expect(src).toContain('.git-inline-loading-status {');
    expect(src).toContain('.git-inline-loading-status__skeleton {');
    expect(src).toContain('animation: redeven-loading-shimmer 2.4s linear infinite;');
    expect(src).not.toContain('.git-loading-indicator {');
    expect(src).toContain('.redeven-terminal-loading-curtain {');
    expect(src).toContain('--redeven-terminal-loading-background');
    expect(src).toContain('--redeven-terminal-loading-foreground');
    expect(src).toContain('.redeven-workbench-progress-curtain {');
    expect(src).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(src).toContain('.redeven-collection-loading-skeleton .floe-skeleton {');
    expect(src).toContain('.git-inline-loading-status__skeleton::after,');
    expect(src).toContain('animation: none;');
    expect(src).not.toContain('.workbench-entry-intro');
    expect(src).not.toContain('.redeven-workbench-intro-preparing');
    expect(src).not.toContain('perspective: 1400px;');
  });

  it('keeps managed operation labels readable and free of decorative motion', () => {
    const src = readRedevenCss();

    expect(src).toContain('.managed-operation-shimmer-text {');
    expect(src).not.toContain('animation: managed-operation-text-shimmer 2.4s linear infinite;');
    expect(src).not.toContain('@keyframes managed-operation-text-shimmer {');
    expect(src).toContain('.managed-operation-shimmer-text {\n  color: var(--foreground);\n}');
  });

  it('keeps git branch graph details compact and responsive', () => {
    const src = readRedevenCss();

    expect(src).toContain('.git-branch-history-details {');
    expect(src).toContain('min-height: 100%;');
    expect(src).toContain('.git-branch-history-summary {');
    expect(src).toContain('.git-branch-history-summary-title {');
    expect(src).toContain('.git-branch-history-files {');
    expect(src).toContain('.git-branch-history-files__table :where(th, td):first-child');
    expect(src).not.toContain('.git-branch-header-verification-slot {');
    expect(src).not.toContain('.git-branch-header-inline-status {');
    expect(src).toContain('.git-branch-detail-banner {');
    expect(src).toContain(".git-branch-detail-banner[data-git-branch-detail-state='error'] {");
    expect(src).toContain('.git-branch-detached-context {');
    expect(src).toContain('.git-branch-detached-context__summary {');
    expect(src).toContain('.git-branch-status-unavailable-summary {');
    expect(src).toContain('.git-branch-status-unavailable__state {');
    expect(src).toContain('.git-branch-stable-placeholder {');
    expect(src).toContain('html.dark .git-branch-detail-banner {');
    expect(src).toContain('html.dark .git-branch-detached-context {');
    expect(src).toContain('html.dark .git-branch-status-unavailable-summary {');
    expect(src).toContain('html.dark .git-branch-stable-placeholder {');
    expect(src).toContain('.git-content-skeleton__split {');
    expect(src).toContain('.git-content-skeleton__detail-panel {');
    expect(src).toContain('@media (max-width: 640px) {');
    expect(src).not.toContain('.git-branch-stable-placeholder__body');
    expect(src).not.toContain('.git-branch-history-reveal');
  });

  it('keeps terminal activity in local header icons with accessible status', () => {
    const css = readRedevenCss();
    const source = fs.readFileSync(new URL('../ui/widgets/TerminalPanel.tsx', import.meta.url), 'utf8');
    expect(css).not.toContain('redeven-terminal-work-indicator');
    expect(source).toContain('redeven-terminal-work-status');
    expect(source).toContain('aria-label={terminalWorkIndicatorLabel()}');
    expect(source).toContain('motion-reduce:animate-none');
    expect(source).toContain("if (!workIndicatorEnabled())");
    expect(source).toContain("variant === 'workbench' ? panelWorkState() : 'idle'");
  });

  it('defines reusable semantic surface and divider classes for local Env App consumers', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-surface-panel {');
    expect(src).toContain('.redeven-surface-panel--interactive {');
    expect(src).toContain('.redeven-surface-panel--strong {');
    expect(src).toContain('.redeven-surface-overlay {');
    expect(src).toContain('.redeven-surface-control {');
    expect(src).toContain('.redeven-surface-control--muted {');
    expect(src).toContain('.git-browser-selection-surface {');
    expect(src).toContain('.git-browser-selection-row {');
    expect(src).toContain('.git-browser-selection-nav {');
    expect(src).toContain('.git-browser-selection-secondary {');
    expect(src).toContain('.git-browser-selection-chip {');
    expect(src).toContain('.git-browser-current-chip {');
    expect(src).not.toContain('.git-browser-segmented-tab.redeven-surface-segmented__item--active {');
    expect(src).toContain('.git-browser-interactive:hover');
    expect(src).toContain('.git-browser-interactive:focus-visible {');
    expect(src).toContain('--tag-surface: var(--git-browser-selection-chip-bg);');
    expect(src).toContain('--tag-line: var(--git-browser-selection-chip-border);');
    expect(src).toContain('--tag-ink: var(--git-browser-selection-chip-fg);');
    expect(src).toContain('.redeven-surface-segmented {');
    expect(src).toContain('.redeven-surface-segmented__item {');
    expect(src).toContain('cursor: pointer;');
    expect(src).toContain(".redeven-surface-segmented__item:disabled,");
    expect(src).toContain("cursor: not-allowed;");
    expect(src).toContain('.redeven-surface-segmented__item--active {');
    expect(src).toContain('background: var(--primary) !important;');
    expect(src).toContain('color: var(--primary-foreground) !important;');
    expect(src).toContain('.redeven-surface-inset {');
    expect(src).toContain('.redeven-divider {');
    expect(src).toContain('.redeven-divider--strong {');
  });

  it('defines the Notes shell viewport contract so shared fixed and portal surfaces stay inside the Env App content host', () => {
    const src = readRedevenCss();

    expect(src).toContain("--redeven-notes-overlay-viewport-top: 0px;");
    expect(src).toContain("--redeven-notes-overlay-viewport-left: 0px;");
    expect(src).toContain("--redeven-notes-overlay-viewport-right: 0px;");
    expect(src).toContain("--redeven-notes-overlay-viewport-bottom: 0px;");
    expect(src).toContain("--redeven-notes-overlay-viewport-width: 100vw;");
    expect(src).toContain("--redeven-notes-overlay-viewport-height: 100vh;");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-overlay {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-trash-backdrop,");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-trash__panel {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-overview-backdrop,");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-menu-backdrop {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-trash__flyout {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-overview-flyout {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-overview--mobile {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-menu,");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-context-menu {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-flyout {");
    expect(src).toContain("body[data-redeven-notes-overlay-viewport='active'] .notes-flyout--paste {");
  });
});
