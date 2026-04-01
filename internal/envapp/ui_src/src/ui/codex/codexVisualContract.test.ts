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
