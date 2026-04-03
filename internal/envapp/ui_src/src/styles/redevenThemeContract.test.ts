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
    expect(src).toContain('html.dark .git-meta-pill:not(.git-browser-selection-chip) {');
    expect(src).toContain('background-color: color-mix(in srgb, var(--tag-bg) 72%, white 28%);');
    expect(src).toContain('.git-browser-selection-chip {');
    expect(src).toContain('--tag-bg: var(--git-browser-selection-chip-bg);');
    expect(src).toContain('--tag-border: var(--git-browser-selection-chip-border);');
    expect(src).toContain('--tag-color: var(--git-browser-selection-chip-fg);');
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
});
