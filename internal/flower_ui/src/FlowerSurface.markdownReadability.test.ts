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

describe('Flower markdown readability', () => {
  it('keeps assistant markdown on a wider reading rhythm', () => {
    const css = flowerStyles();

    expect(css).toContain('.flower-message-block-stack-assistant');
    expect(css).toContain('gap: 0.75rem');
    expect(css).toContain('.flower-message-bubble-assistant .flower-chat-md-block');
    expect(css).toContain('max-width: min(100%, 58rem)');
    expect(css).toContain('line-height: 1.75');
    expect(css).toContain('.flower-chat-md-block h1');
    expect(css).toContain('font-size: 1.28rem');
    expect(css).toContain('.flower-chat-md-block hr');
  });

  it('keeps markdown dividers and code treatments visually distinct', () => {
    const css = flowerStyles();
    const blockRule = cssRule(css, '.flower-chat-md-block');
    const dividerRule = cssRule(css, '.flower-chat-md-block hr');
    const inlineCodeRule = cssRule(css, '.flower-chat-md-inline-code');
    const codeBlockRule = cssRule(css, '.flower-chat-md-code-block');

    expect(blockRule).toContain("--flower-chat-md-code-font: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono'");
    expect(blockRule).not.toContain('Iosevka');
    expect(dividerRule).toContain('margin: 1.7rem 0 1.05rem');
    expect(dividerRule).toContain('var(--flower-chat-surface-border) 58%');
    expect(inlineCodeRule).toContain('var(--flower-chat-surface-elevated) 66%, var(--foreground) 24%');
    expect(inlineCodeRule).toContain('font-family: var(--flower-chat-md-code-font)');
    expect(inlineCodeRule).toContain('font-weight: 560');
    expect(codeBlockRule).toContain('font-family: var(--flower-chat-md-code-font)');
    expect(codeBlockRule).toContain('font-size: 0.8125rem');
    expect(codeBlockRule).toContain('line-height: 1.68');
  });
});
