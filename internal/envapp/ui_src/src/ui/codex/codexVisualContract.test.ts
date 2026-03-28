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
    expect(src).toMatch(/\.codex-chat-markdown-block \.chat-md-file-ref \{[\s\S]*background: transparent;/);
    expect(src).not.toContain('linear-gradient(');
    expect(src).not.toContain('radial-gradient(');
  });

  it('keeps empty and loading ornaments on the neutral Codex shell class', () => {
    const src = readCodexTranscript();

    expect(src.match(/class="codex-empty-ornament"/g)?.length ?? 0).toBe(2);
    expect(src).not.toContain('bg-gradient-to-br');
  });
});
