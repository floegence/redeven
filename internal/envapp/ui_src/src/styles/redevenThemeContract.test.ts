import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readRedevenCss(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, './redeven.css'), 'utf8');
}

describe('Redeven Env App surface theme contract', () => {
  it('defines the root panel surface family, paired stroke tokens, and aliases shared card/popover tokens to it', () => {
    const src = readRedevenCss();

    expect(src).toContain('--redeven-surface-panel: rgb(246, 245, 244);');
    expect(src).toContain('--redeven-surface-panel-soft: #fafbfc;');
    expect(src).toContain('--redeven-surface-panel-elevated: #ffffff;');
    expect(src).toContain('--redeven-surface-overlay: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--redeven-surface-control: color-mix(in srgb, var(--background) 86%, var(--redeven-surface-panel-elevated) 14%);');
    expect(src).toContain('--redeven-surface-control-muted: color-mix(in srgb, var(--muted) 46%, var(--background));');
    expect(src).toContain('--redeven-surface-panel-border: color-mix(in srgb, var(--border) 82%, white 18%);');
    expect(src).toContain('--redeven-stroke-panel: var(--redeven-surface-panel-border);');
    expect(src).toContain('--redeven-stroke-panel-strong: color-mix(in srgb, var(--redeven-stroke-panel) 72%, var(--foreground) 28%);');
    expect(src).toContain('--redeven-stroke-overlay: color-mix(in srgb, var(--redeven-stroke-panel) 82%, var(--foreground) 18%);');
    expect(src).toContain('--redeven-stroke-control: color-mix(in srgb, var(--redeven-stroke-panel) 76%, var(--foreground) 24%);');
    expect(src).toContain('--redeven-stroke-control-strong: color-mix(in srgb, var(--redeven-stroke-control) 74%, var(--foreground) 26%);');
    expect(src).toContain('--redeven-stroke-divider: color-mix(in srgb, var(--redeven-stroke-panel) 72%, transparent);');
    expect(src).toContain('--card: var(--redeven-surface-panel);');
    expect(src).toContain('--popover: var(--redeven-surface-panel);');
    expect(src).toContain('--git-browser-selection-secondary-fg: color-mix(in srgb, var(--git-browser-selection-fg) 78%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-bg: color-mix(in srgb, var(--git-browser-selection-fg) 10%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-border: color-mix(in srgb, var(--git-browser-selection-fg) 14%, var(--git-browser-selection-border) 86%);');
    expect(src).toContain('--git-browser-selection-chip-fg: var(--git-browser-selection-fg);');

    expect(src).toContain('--redeven-surface-panel: rgb(41, 44, 51);');
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
    expect(src).toContain('--git-browser-selection-secondary-fg: color-mix(in srgb, var(--git-browser-selection-fg) 82%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-bg: color-mix(in srgb, var(--git-browser-selection-fg) 10%, transparent);');
    expect(src).toContain('--git-browser-selection-chip-border: color-mix(in srgb, var(--git-browser-selection-fg) 18%, var(--git-browser-selection-border) 82%);');
    expect(src).toContain('--git-browser-selection-chip-fg: var(--git-browser-selection-fg);');
  });

  it('keeps Flower on the shared panel surface family instead of private raw color literals', () => {
    const src = readRedevenCss();

    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-panel);');
    expect(src).toContain('--flower-chat-surface-soft: var(--redeven-surface-panel-soft);');
    expect(src).toContain('--flower-chat-surface-elevated: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--flower-chat-surface-border: var(--redeven-surface-panel-border);');
    expect(src).not.toContain('--flower-chat-surface: rgb(246, 245, 244);');
    expect(src).not.toContain('--flower-chat-surface: rgb(41, 44, 51);');
    expect(src.match(/rgb\(246, 245, 244\)/g)?.length ?? 0).toBe(1);
    expect(src.match(/rgb\(41, 44, 51\)/g)?.length ?? 0).toBe(1);
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

  it('defines a non-interactive terminal work indicator with reduced-motion support', () => {
    const src = readRedevenCss();

    expect(src).toContain('.redeven-terminal-work-indicator {');
    expect(src).toContain('pointer-events: none;');
    expect(src).toContain("--redeven-terminal-work-indicator-size: 3.5px;");
    expect(src).toContain('inset: calc(-1 * var(--redeven-terminal-work-indicator-outset));');
    expect(src).toContain('--redeven-terminal-work-indicator-outset: calc(var(--redeven-terminal-work-indicator-size) * 0.28);');
    expect(src).toContain('--redeven-terminal-work-sky: #47a7ff;');
    expect(src).toContain('--redeven-terminal-work-emerald: #35f28c;');
    expect(src).toContain('--redeven-terminal-work-aqua: #38ffe2;');
    expect(src).toContain('--redeven-terminal-work-bright: #dcfff7;');
    expect(src).toContain('--redeven-terminal-work-running-line: #7bdc5f;');
    expect(src).toContain(".redeven-terminal-work-indicator[data-terminal-work-theme='light'] {");
    expect(src).toContain('--redeven-terminal-work-sky: #1a73e8;');
    expect(src).toContain('--redeven-terminal-work-mint: #7eadff;');
    expect(src).toContain('--redeven-terminal-work-bright: #d2e3fc;');
    expect(src).toContain('--redeven-terminal-work-running-line: #00e000;');
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
