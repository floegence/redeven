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

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe('Redeven Env App surface theme contract', () => {
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

  it('defines the light demo palette, root surface family, and paired stroke tokens', () => {
    const src = readRedevenCss();

    expect(src).toContain(":root[data-floe-shell-theme='classic-light'],");
    expect(src).toContain(":root:not([data-floe-shell-theme]):not(.dark),");
    expect(src).toContain(":root[data-floe-shell-theme='classic-dark'],");
    expect(src).toContain(":root:not([data-floe-shell-theme]).dark {");
    expect(src).not.toContain(':root:not(.dark),\n.light {');
    expect(src).toContain('--background: #f4f1ed;');
    expect(src).toContain('--foreground: #202a37;');
    expect(src).toContain('--primary: #202a37;');
    expect(src).toContain('--ring: #202a37;');
    expect(src).toContain('--primary-foreground: #fffdfa;');
    expect(src).toContain('--secondary: #f1efec;');
    expect(src).toContain('--muted: #f1efec;');
    expect(src).toContain('--muted-foreground: #5a687c;');
    expect(src).toContain('--accent: #e4e1dd;');
    expect(src).toContain('--sidebar-accent: #e4e1dd;');
    expect(src).toContain('--border: #d8d3cc;');
    expect(src).toContain('--input: #ccc5ba;');
    expect(src).toContain('--sidebar: #eeece9;');
    expect(src).toContain('--activity-bar: #eeece9;');
    expect(src).toContain('--activity-bar-foreground: #5a687c;');
    expect(src).toContain('--chrome-border: #dad6d1;');
    expect(src).toContain('--sidebar-border: #dad6d1;');
    expect(src).toContain('--info: #3b82f6;');
    expect(src).toContain('--warning: #f59e0b;');
    expect(src).toContain('--redeven-runtime-monitor-cpu-line: var(--redeven-categorical-graph-1);');
    expect(src).toContain('--redeven-surface-main: #f4f1ed;');
    expect(src).toContain('--redeven-surface-panel: #f7f4f1;');
    expect(src).toContain('--redeven-surface-panel-soft: #f1efec;');
    expect(src).toContain('--redeven-surface-panel-elevated: #fffdfa;');
    expect(src).toContain('--redeven-surface-overlay: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--redeven-surface-control: color-mix(in srgb, var(--redeven-surface-panel) 58%, var(--redeven-surface-panel-elevated) 42%);');
    expect(src).toContain('--redeven-surface-control-muted: #f1efec;');
    expect(src).toContain('--redeven-surface-panel-border: color-mix(in srgb, var(--border) 82%, var(--redeven-surface-highlight-source) 18%);');
    expect(src).toContain('--redeven-stroke-panel: var(--redeven-surface-panel-border);');
    expect(src).toContain('--redeven-stroke-panel-strong: color-mix(in srgb, var(--redeven-stroke-panel) 72%, var(--foreground) 28%);');
    expect(src).toContain('--redeven-stroke-overlay: color-mix(in srgb, var(--redeven-stroke-panel) 82%, var(--foreground) 18%);');
    expect(src).toContain('--redeven-stroke-control: color-mix(in srgb, var(--redeven-stroke-panel) 76%, var(--foreground) 24%);');
    expect(src).toContain('--redeven-stroke-control-strong: color-mix(in srgb, var(--redeven-stroke-control) 74%, var(--foreground) 26%);');
    expect(src).toContain('--redeven-stroke-divider: color-mix(in srgb, var(--redeven-stroke-panel) 72%, transparent);');
    expect(src).toContain('--redeven-link-fg: var(--color-blue-600);');
    expect(src).toContain('--redeven-link-hover-fg: var(--color-blue-700);');
    expect(src).toContain('--redeven-link-code-bg: color-mix(in srgb, var(--redeven-link-fg) 9%, var(--background));');
    expect(src).toContain('--card: #fffdfa;');
    expect(src).toContain('--popover: #fffdfa;');
    expect(src).toContain('--git-browser-selection-bg: color-mix(in srgb, var(--primary) 8%, var(--background));');
    expect(src).toContain('--git-browser-selection-secondary-fg: color-mix(in srgb, var(--muted-foreground) 88%, var(--foreground) 12%);');
    expect(src).toContain('--git-browser-selection-chip-bg: color-mix(in srgb, var(--primary) 9%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-border: color-mix(in srgb, var(--primary) 18%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-fg: color-mix(in srgb, var(--primary) 78%, var(--foreground) 22%);');
    expect(src).toContain('--git-browser-selection-shadow: none;');
    expect(src).not.toContain(':root {\n  /* Keep the Env App light surface contract on the document scope so body portals inherit it too. */\n  --background:');

    expect(src).toContain('--redeven-surface-panel: rgb(41, 44, 51);');
    expect(src).toContain('--redeven-runtime-monitor-upload-line: var(--redeven-categorical-graph-5);');
    expect(src).toContain('--redeven-surface-main: var(--redeven-surface-panel);');
    expect(src).toContain('--redeven-surface-panel-soft: #353942;');
    expect(src).toContain('--redeven-surface-panel-elevated: #40454f;');
    expect(src).toContain('--redeven-surface-overlay: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--redeven-surface-control: color-mix(in srgb, var(--background) 62%, var(--redeven-surface-panel-elevated) 38%);');
    expect(src).toContain('--redeven-surface-control-muted: color-mix(in srgb, var(--muted) 56%, var(--background));');
    expect(src).toContain('--redeven-surface-panel-border: color-mix(in srgb, var(--border) 82%, #616976 18%);');
    expect(src).toContain('--redeven-stroke-panel: var(--redeven-surface-panel-border);');
    expect(src).toContain('--redeven-stroke-panel-strong: color-mix(in srgb, var(--redeven-stroke-panel) 62%, var(--foreground) 38%);');
    expect(src).toContain('--redeven-stroke-overlay: color-mix(in srgb, var(--redeven-stroke-panel) 74%, var(--foreground) 26%);');
    expect(src).toContain('--redeven-stroke-control: color-mix(in srgb, var(--redeven-stroke-panel) 68%, var(--foreground) 32%);');
    expect(src).toContain('--redeven-stroke-control-strong: color-mix(in srgb, var(--redeven-stroke-control) 68%, var(--foreground) 32%);');
    expect(src).toContain('--redeven-stroke-divider: color-mix(in srgb, var(--redeven-stroke-panel) 74%, transparent);');
    expect(src).toContain('--redeven-link-fg: var(--color-sky-400);');
    expect(src).toContain('--redeven-link-hover-fg: var(--color-sky-300);');
    expect(src).toContain('--redeven-link-code-bg: color-mix(in srgb, var(--redeven-link-fg) 13%, var(--background));');
    expect(src).toContain('--git-browser-selection-bg: color-mix(in srgb, var(--primary) 13%, var(--redeven-surface-panel));');
    expect(src).toContain('--git-browser-selection-secondary-fg: color-mix(in srgb, var(--muted-foreground) 86%, var(--foreground) 14%);');
    expect(src).toContain('--git-browser-selection-chip-bg: color-mix(in srgb, var(--primary) 13%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-border: color-mix(in srgb, var(--primary) 24%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-fg: color-mix(in srgb, var(--primary) 62%, var(--foreground) 38%);');
  });

  it('keeps the main content surface separate from shell chrome and global palette tokens', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-surface-main {');
    expect(src).toContain('background: var(--redeven-surface-main) !important;');
    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-main);');
    expect(src).toContain('--redeven-workbench-default-body-surface: var(--redeven-surface-main);');
    expect(src).not.toContain('--background: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--muted: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--border: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--sidebar: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).not.toContain('--activity-bar: color-mix(in srgb, var(--redeven-surface-panel)');
    expect(src).toContain('--card: #fffdfa;');
    expect(src).toContain('--popover: #fffdfa;');
  });

  it('keeps the settings content hierarchy while restoring the warm light sidebar', () => {
    const src = readRedevenCss();

    for (const token of [
      '--redeven-settings-header-bg: #ffffff;',
      '--redeven-settings-sidebar-bg: #e9e5df;',
      '--redeven-settings-sidebar-border: #d0c9bf;',
      '--redeven-settings-content-bg: #f4f6f8;',
      '--redeven-settings-card-bg: #ffffff;',
      '--redeven-settings-sidebar-inset-bg: color-mix(in srgb, var(--redeven-settings-sidebar-bg) 64%, var(--redeven-settings-card-bg) 36%);',
      '--redeven-settings-sidebar-hover-bg: color-mix(in srgb, var(--redeven-settings-sidebar-bg) 92%, var(--foreground) 8%);',
      '--redeven-settings-sidebar-selection-bg: color-mix(in srgb, var(--redeven-settings-sidebar-bg) 88%, var(--foreground) 12%);',
      '--redeven-settings-sidebar-selection-fg: var(--foreground);',
      '--redeven-settings-sidebar-selection-indicator: color-mix(in srgb, var(--foreground) 64%, var(--redeven-settings-sidebar-bg) 36%);',
      '--redeven-settings-sidebar-note-fg: #5a687c;',
      '--redeven-settings-sidebar-control-border: #748092;',
      '--redeven-settings-inset-bg: #f7f8fa;',
      '--redeven-settings-row-hover-bg: #eef2f6;',
      '--redeven-settings-card-border: #d8dee6;',
      '--redeven-settings-divider: #e4e8ee;',
      '--redeven-settings-label-fg: #475569;',
      '--redeven-settings-note-fg: #667085;',
      '--redeven-settings-selection-bg: #e8f0fe;',
      '--redeven-settings-selection-indicator: #3b82f6;',
      '--redeven-settings-choice-selected-bg: #f1f3f5;',
      '--redeven-settings-choice-selected-border: #aeb7c2;',
      '--redeven-settings-control-border: #8793a5;',
      '--redeven-settings-header-bg: #141820;',
      '--redeven-settings-sidebar-bg: #141820;',
      '--redeven-settings-sidebar-border: #2b323d;',
      '--redeven-settings-content-bg: #181c23;',
      '--redeven-settings-card-bg: #222730;',
      '--redeven-settings-sidebar-inset-bg: #1b2027;',
      '--redeven-settings-sidebar-hover-bg: #282e38;',
      '--redeven-settings-sidebar-selection-bg: var(--redeven-settings-selection-bg);',
      '--redeven-settings-sidebar-selection-fg: var(--redeven-settings-selection-fg);',
      '--redeven-settings-sidebar-selection-indicator: var(--redeven-settings-selection-indicator);',
      '--redeven-settings-sidebar-note-fg: #94a3b8;',
      '--redeven-settings-sidebar-control-border: #68788f;',
      '--redeven-settings-inset-bg: #1b2027;',
      '--redeven-settings-row-hover-bg: #282e38;',
      '--redeven-settings-card-border: #343c48;',
      '--redeven-settings-divider: #2b323d;',
      '--redeven-settings-label-fg: #c0c9d6;',
      '--redeven-settings-note-fg: #94a3b8;',
      '--redeven-settings-selection-bg: #22324a;',
      '--redeven-settings-selection-indicator: #6ea8fe;',
      '--redeven-settings-choice-selected-bg: #262b32;',
      '--redeven-settings-choice-selected-border: #4c5664;',
      '--redeven-settings-control-border: #68788f;',
    ]) {
      expect(src).toContain(token);
    }

    expect(src).toContain('.redeven-settings-table {');
    expect(src).toContain('background: var(--redeven-settings-inset-bg);');
    expect(src).toContain('.redeven-settings-list > .redeven-setting-row + .redeven-setting-row {');
    expect(src).toContain('.redeven-settings-nav-item--active,');
    expect(src).toContain('.redeven-settings-sidebar-note {');
    expect(src).toContain(':root:not(.dark) .redeven-settings-sidebar-group-label,');
    expect(src).toContain('border-color: var(--redeven-settings-sidebar-control-border);');
    expect(src).toContain('background: var(--redeven-settings-sidebar-inset-bg);');
    expect(src).toContain('background: var(--redeven-settings-sidebar-hover-bg) !important;');
    expect(src).toContain('border-color: var(--redeven-settings-sidebar-selection-indicator) !important;');
    expect(src).toContain('background: var(--redeven-settings-sidebar-selection-bg) !important;');
    expect(src).toContain('color: var(--redeven-settings-sidebar-selection-fg) !important;');
    expect(src).toContain(":not([type='range']):not(.redeven-settings-search),");
    expect(src).not.toContain('--redeven-settings-content-bg: #fffdfa;');
    expect(src).not.toContain('--redeven-settings-card-bg: #363b45;');
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

  it('keeps settings text and control boundaries above their accessibility thresholds', () => {
    expect(contrastRatio('#202a37', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#475569', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#667085', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#667085', '#f7f8fa')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#8793a5', '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#5a687c', '#e9e5df')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#748092', '#e9e5df')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#202a37', '#d1ceca')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#686d74', '#d1ceca')).toBeGreaterThanOrEqual(3);

    expect(contrastRatio('#f9fafb', '#222730')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#c0c9d6', '#222730')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#94a3b8', '#222730')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#94a3b8', '#1b2027')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#68788f', '#222730')).toBeGreaterThanOrEqual(3);
  });

  it('keeps Flower on the shared main content surface family instead of private raw color literals', () => {
    const src = readRedevenCss();

    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-main);');
    expect(src).toContain('--flower-chat-surface-soft: var(--redeven-surface-panel-soft);');
    expect(src).toContain('--flower-chat-surface-elevated: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--flower-chat-surface-border: var(--redeven-surface-panel-border);');
    expect(src).not.toContain('--flower-chat-surface: #f7f4f1;');
    expect(src).not.toContain('--flower-chat-surface: rgb(41, 44, 51);');
    expect(src.match(/--redeven-surface-panel: #f7f4f1;/g)?.length ?? 0).toBe(1);
    expect(src.match(/rgb\(41, 44, 51\)/g)?.length ?? 0).toBe(1);
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

  it('removes the Flower glow only for the dark-mode activity icon and chat avatar variants', () => {
    const src = readRedevenCss();

    expect(src).toContain('html.dark .redeven-flower-soft-aura-nav-glow,');
    expect(src).toContain('html.dark .redeven-flower-soft-aura-avatar .redeven-flower-soft-aura-glow {');
    expect(src).toContain('opacity: 0;');
    expect(src).toContain('filter: none;');
  });

  it('defines compact workbench icon support for Flower and Codex launcher slots', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-flower-soft-aura-workbench-glow {');
    expect(src).toContain('.redeven-flower-soft-aura-workbench-svg {');
    expect(src).toContain('html.dark .redeven-flower-soft-aura-workbench-glow {');
    expect(src).toContain('.redeven-codex-workbench-icon {');
    expect(src).toContain('border: 1px solid color-mix(in srgb, currentColor 12%, transparent);');
    expect(src).toContain('.redeven-codex-workbench-icon__art {');
    expect(src).toContain('html.dark .redeven-codex-workbench-icon {');
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
    expect(src).toContain(".redeven-workbench-page[data-redeven-workbench-layout-interacting='true'] .redeven-terminal-work-indicator {");
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
    expect(src).toContain('color-mix(in srgb, var(--primary) 78%, var(--redeven-surface-highlight-source) 18%)');
    expect(src).toContain('animation: redeven-loading-curtain-sweep 1.35s cubic-bezier(0.42, 0, 0.2, 1) infinite;');
    expect(src).toContain('@keyframes redeven-loading-curtain-sweep {');
    expect(src).toContain('.redeven-loading-curtain__message {');
    expect(src).toContain('.git-state-pane__loading-stack {');
    expect(src).toContain('.git-state-pane__loading-eyebrow {');
    expect(src).toContain('letter-spacing: 0;');
    expect(src).toContain('.git-loading-indicator {');
    expect(src).toContain('.git-loading-indicator--inline {');
    expect(src).toContain('.git-loading-indicator__track {');
    expect(src).toContain('.git-loading-indicator__bar {');
    expect(src).toContain('.git-inline-loading-status {');
    expect(src).toContain('.git-inline-loading-status__label {');
    expect(src).toContain('animation: redeven-loading-curtain-sweep 1.35s cubic-bezier(0.42, 0, 0.2, 1) infinite;');
    expect(src).toContain('.redeven-terminal-loading-curtain {');
    expect(src).toContain('--redeven-terminal-loading-background');
    expect(src).toContain('--redeven-terminal-loading-foreground');
    expect(src).toContain('.redeven-workbench-progress-curtain {');
    expect(src).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(src).toContain('.redeven-collection-loading-skeleton .floe-skeleton {');
    expect(src).toContain('.git-loading-indicator__bar {');
    expect(src).toContain('animation: none;');
    expect(src).not.toContain('.workbench-entry-intro');
    expect(src).not.toContain('.redeven-workbench-intro-preparing');
    expect(src).not.toContain('perspective: 1400px;');
  });

  it('keeps git branch history expansion quiet and motion-aware', () => {
    const src = readRedevenCss();

    expect(src).toContain('.git-branch-history-row {');
    expect(src).toContain('.git-branch-history-row--expanded {');
    expect(src).toContain('.git-branch-history-details-row {');
    expect(src).toContain('.git-branch-history-reveal {');
    expect(src).toContain('grid-template-rows: 0fr;');
    expect(src).toContain(".git-branch-history-reveal[data-state='open'] {");
    expect(src).toContain('grid-template-rows: 1fr;');
    expect(src).toContain(".git-branch-history-reveal[data-state='closing'] {");
    expect(src).toContain('.git-branch-history-details::before {');
    expect(src).toContain('.git-branch-history-files {');
    expect(src).toContain('.git-branch-history-files__table :where(th, td):first-child');
    expect(src).toContain('.git-branch-header-verification-slot {');
    expect(src).toContain(".git-branch-header-verification-slot[data-git-branch-verification-state='idle'] {");
    expect(src).toContain('.git-branch-header-inline-status {');
    expect(src).toContain('.git-branch-detail-banner {');
    expect(src).toContain(".git-branch-detail-banner[data-git-branch-detail-state='error'] {");
    expect(src).toContain('.git-branch-detached-context {');
    expect(src).toContain('.git-branch-detached-context__summary {');
    expect(src).toContain('.git-branch-status-unavailable-summary {');
    expect(src).toContain('.git-branch-status-unavailable__state {');
    expect(src).toContain('.git-branch-stable-placeholder {');
    expect(src).toContain('.git-branch-stable-placeholder__body {');
    expect(src).toContain('.git-branch-stable-placeholder__table {');
    expect(src).toContain('.git-branch-stable-placeholder__header,');
    expect(src).toContain('.git-branch-stable-placeholder__row {');
    expect(src).toContain('.git-branch-stable-placeholder__cell {');
    expect(src).toContain('html.dark .git-branch-history-details-row {');
    expect(src).toContain('html.dark .git-branch-detail-banner {');
    expect(src).toContain('html.dark .git-branch-detached-context {');
    expect(src).toContain('html.dark .git-branch-status-unavailable-summary {');
    expect(src).toContain('html.dark .git-branch-stable-placeholder {');
    expect(src).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(src).toContain('.git-branch-history-reveal[data-state=\'closing\']');
  });

  it('defines a non-interactive terminal work indicator with reduced-motion support', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-terminal-work-indicator {');
    expect(src).toContain('pointer-events: none;');
    expect(src).toContain("--redeven-terminal-work-indicator-size: 3.5px;");
    expect(src).toContain('inset: calc(-1 * var(--redeven-terminal-work-indicator-outset));');
    expect(src).toContain('--redeven-terminal-work-indicator-outset: calc(var(--redeven-terminal-work-indicator-size) * 0.28);');
    expect(src).toContain('--redeven-terminal-work-sky: var(--redeven-status-info);');
    expect(src).toContain('--redeven-terminal-work-emerald: var(--redeven-status-success);');
    expect(src).toContain('--redeven-terminal-work-aqua: var(--redeven-categorical-7);');
    expect(src).toContain('--redeven-terminal-work-bright: var(--foreground);');
    expect(src).toContain('--redeven-terminal-work-running-line: var(--redeven-status-success);');
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-theme='light'] {");
    expect(src).toContain('--redeven-terminal-work-sky: var(--redeven-status-info);');
    expect(src).toContain('--redeven-terminal-work-mint: var(--redeven-categorical-8);');
    expect(src).toContain('--redeven-terminal-work-bright: var(--foreground);');
    expect(src).toContain('--redeven-terminal-work-running-line: var(--redeven-status-success);');
    expect(src).toContain('--redeven-terminal-work-running-opacity-low: 0.84;');
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-state='active'] {");
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-state='running'] {");
    expect(src).toContain('box-shadow:');
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-state='active']::before {");
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-state='running']::before {");
    expect(src).toContain('@property --redeven-terminal-work-flow-angle {');
    expect(src).toContain('conic-gradient(');
    expect(src).toContain('@keyframes redeven-terminal-work-indicator-flow {');
    expect(src).toContain('@keyframes redeven-terminal-work-indicator-breathe {');
    expect(src).toContain('--redeven-terminal-work-flow-angle: 360deg;');
    expect(src).toContain('background: var(--redeven-terminal-work-running-line);');
    expect(src).toContain('will-change: background;');
    expect(src).toContain('@media (prefers-reduced-motion: reduce) {');

    const indicatorCss = src.slice(src.indexOf('.redeven-terminal-work-indicator {'), src.indexOf(':root {'));
    expect(indicatorCss).not.toContain('transform: rotate');
    expect(indicatorCss).toContain('drop-shadow(0 0 calc(var(--redeven-terminal-work-indicator-size) * 0.8)');
    expect(indicatorCss).toContain('inset 0 0 calc(var(--redeven-terminal-work-indicator-size) * 0.85) var(--redeven-terminal-work-track-glow)');
    expect(indicatorCss).not.toContain('drop-shadow(0 0 10px');
    expect(indicatorCss).not.toContain('drop-shadow(0 0 16px');
    expect(indicatorCss).not.toContain('drop-shadow(0 0 24px');
    expect(indicatorCss).not.toContain('drop-shadow(0 0 28px');
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
    expect(src).toContain('--tag-surface: var(--git-browser-selection-chip-bg);');
    expect(src).toContain('--tag-line: var(--git-browser-selection-chip-border);');
    expect(src).toContain('--tag-ink: var(--git-browser-selection-chip-fg);');
    expect(src).toContain('.redeven-surface-segmented {');
    expect(src).toContain('.redeven-surface-segmented__item {');
    expect(src).toContain('cursor: pointer;');
    expect(src).toContain(".redeven-surface-segmented__item:disabled,");
    expect(src).toContain("cursor: not-allowed;");
    expect(src).toContain('.redeven-surface-segmented__item--active {');
    expect(src).toContain('color: var(--foreground) !important;');
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
