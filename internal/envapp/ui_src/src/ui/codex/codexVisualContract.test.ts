import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveFromHere(relativePath: string): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), relativePath);
}

function readCodexCss(): string {
  return fs.readFileSync(resolveFromHere('./codex.css'), 'utf8');
}

function readCodexTranscript(): string {
  return fs.readFileSync(resolveFromHere('./CodexTranscript.tsx'), 'utf8');
}

describe('Codex visual contract', () => {
  it('keeps codex.css on semantic flat surfaces without gradients', () => {
    const src = readCodexCss();

    expect(src).toContain('--codex-surface-page:');
    expect(src).toContain('--codex-surface-panel:');
    expect(src).toContain('--codex-surface-panel-subtle:');
    expect(src).toContain('--codex-surface-accent-subtle:');
    expect(src).toContain('--codex-surface-warning-subtle:');
    expect(src).toContain('--codex-border-default:');
    expect(src).toContain('--codex-border-accent:');
    expect(src).toContain('--codex-text-secondary:');
    expect(src).toContain('.codex-page-shell .chat-message-bubble-user {');
    expect(src).toContain('.codex-page-shell .chat-input-send-btn-active {');
    expect(src).toMatch(/\.codex-chat-reasoning-card \{[\s\S]*background: var\(--codex-surface-page\);/);
    expect(src).not.toContain('.codex-chat-markdown-block .chat-md-file-ref {');
    expect(src).not.toContain('linear-gradient(');
    expect(src).not.toContain('radial-gradient(');
  });

  it('keeps the Codex empty hero visually centered without phantom bottom spacing', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-empty-hero \{[\s\S]*margin: 0;[\s\S]*text-align: center;/);
    expect(src).toMatch(/\.codex-empty-hero \+ \.codex-empty-suggestions \{[\s\S]*margin-top: 2rem;/);
  });

  it('keeps header controls compact and wrap-friendly for narrow Codex layouts', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-page-header-rail \{[\s\S]*max-width: min\(100%, 32rem\);[\s\S]*justify-content: flex-end;[\s\S]*flex-wrap: wrap;/);
    expect(src).toMatch(/\.codex-page-header-rail \.codex-page-header-action \{[\s\S]*width: auto;[\s\S]*height: 1\.5rem;[\s\S]*font-size: 0\.6875rem;/);
    expect(src).toMatch(/@media \(max-width: 960px\) \{[\s\S]*\.codex-page-header-main \{[\s\S]*flex-wrap: wrap;[\s\S]*\.codex-page-header-rail \{[\s\S]*justify-content: flex-start;/);
  });

  it('keeps the composer dock softly floating over the transcript tail', () => {
    const src = readCodexCss();

    expect(src).toContain('--flower-chat-transcript-overlay-bottom-inset: calc(7.5rem + env(safe-area-inset-bottom, 0px));');
    expect(src).toMatch(/\.codex-page-bottom-dock \{[^}]*background: transparent;/);
    expect(src).not.toMatch(/\.codex-page-bottom-dock \{[^}]*border-top:/);
    expect(src).toMatch(/\.codex-page-bottom-dock::before \{[^}]*box-shadow: 0 -20px 32px -28px/);
    expect(src).toMatch(/\.codex-chat-input\.chat-input-container \{[^}]*overflow: visible;[^}]*backdrop-filter: blur\(14px\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-track \{[^}]*width: min\(100%, var\(--codex-transcript-lane-max-width\)\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-track-thread \{[^}]*grid-template-columns: var\(--codex-transcript-avatar-size\) minmax\(0, 1fr\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-content-thread \{[^}]*width: min\(100%, var\(--codex-transcript-content-max-width\)\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-content-page \{[^}]*width: 100%;/);
    expect(src).toMatch(/\.codex-chat-popup-overlay \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 0\.4375rem\);/);
    expect(src).toMatch(/\.codex-page-shell \.codex-chat-input-send-btn-stop\.chat-input-send-btn-active \{[^}]*background:/);
  });

  it('keeps composer metadata grouped by layout role and carrier semantics', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-chat-input-meta-rail \{[^}]*justify-content: space-between;[^}]*flex-wrap: wrap;/);
    expect(src).toMatch(/\.codex-chat-input-meta-group-context \{[^}]*justify-content: flex-start;/);
    expect(src).toMatch(/\.codex-chat-input-meta-group-strategy \{[^}]*justify-content: flex-end;/);
    expect(src).toMatch(/\.codex-chat-select-chip-policy \{[^}]*border-color:/);
    expect(src).toMatch(/\.codex-chat-select-chip-control-policy \{[^}]*padding: 0 1rem 0 0\.5rem !important;/);
    expect(src).toMatch(/\.codex-chat-draft-objects \{[^}]*flex-direction: column;/);
  });

  it('keeps Codex markdown blockquotes aligned with the floe-webapp quote block shape', () => {
    const src = readCodexCss();

    expect(src).toMatch(
      /\.codex-chat-markdown-block \.chat-md-blockquote \{[\s\S]*margin: 0\.5rem 0;[\s\S]*border-left-width: 2px;[\s\S]*border-left-color: color-mix\(in srgb, var\(--primary\) 70%, transparent\);[\s\S]*border-radius: 0 0\.375rem 0\.375rem 0;[\s\S]*background: color-mix\(in srgb, var\(--muted\) 50%, transparent\);[\s\S]*color: color-mix\(in srgb, var\(--foreground\) 80%, transparent\);[\s\S]*font-style: normal;[\s\S]*padding: 0\.5rem 0\.75rem;[\s\S]*\}/
    );
  });

  it('keeps empty and loading ornaments on the neutral Codex shell class', () => {
    const src = readCodexTranscript();

    expect(src.match(/class="codex-empty-ornament"/g)?.length ?? 0).toBe(2);
    expect(src).not.toContain('bg-gradient-to-br');
  });
});
