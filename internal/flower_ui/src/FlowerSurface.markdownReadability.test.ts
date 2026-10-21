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
  const start = `\n${css}`.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

describe('Flower markdown readability', () => {
  it('owns message wrapping above bubbles and thinking disclosures', () => {
    const css = flowerStyles();
    const blockStackRule = cssRule(css, '.flower-message-block-stack');
    const bubbleRule = cssRule(css, '.flower-message-bubble');
    const codeBlockRule = cssRule(css, '.flower-chat-md-code-block');

    expect(blockStackRule).toContain('word-break: break-word');
    expect(blockStackRule).toContain('overflow-wrap: anywhere');
    expect(bubbleRule).not.toContain('word-break:');
    expect(bubbleRule).not.toContain('overflow-wrap:');
    expect(codeBlockRule).toContain('overflow-x: auto');
    expect(codeBlockRule).toContain('word-break: normal');
    expect(codeBlockRule).toContain('overflow-wrap: normal');
  });

  it('keeps transcript typography separate from the composer control scale', () => {
    const css = flowerStyles();

    expect(css).toContain('.flower-message-block-stack-assistant');
    expect(css).toContain('gap: 0.75rem');
    expect(css).toContain('.flower-message-bubble-assistant .flower-chat-md-block');
    expect(cssRule(css, '.flower-chat-shell')).toContain('--flower-chat-text-column-width: 43.75rem');
    expect(css).toContain('max-width: min(100%, var(--flower-chat-text-column-width, 43.75rem))');
    expect(cssRule(css, '.flower-message-bubble-assistant')).not.toContain('--flower-message-font-size:');
    expect(cssRule(css, '.flower-message-bubble-assistant')).not.toContain('--flower-message-line-height:');
    expect(cssRule(css, '.flower-message-bubble')).toContain('--flower-message-font-size: 0.875rem');
    expect(cssRule(css, '.flower-message-bubble')).toContain('--flower-message-line-height: 1.75');
    expect(cssRule(css, '.flower-chat-md-block')).toContain('line-height: var(--flower-message-line-height, var(--floe-line-body))');
    expect(css).toContain('.flower-chat-md-block h1');
    expect(cssRule(css, '.flower-chat-md-block h1')).toContain('font-size: 1.5em');
    expect(css).toContain('.flower-chat-md-block hr');
  });

  it('keeps markdown dividers and code treatments visually distinct', () => {
    const css = flowerStyles();
    const blockRule = cssRule(css, '.flower-chat-md-block');
    const dividerRule = cssRule(css, '.flower-chat-md-block hr');
    const headingRule = cssRule(css, '.flower-chat-md-block :is(h1, h2, h3, h4, h5, h6)');
    const inlineCodeRule = cssRule(css, '.flower-chat-md-inline-code');
    const codeBlockRule = cssRule(css, '.flower-chat-md-code-block');
    const framedCodeBlockRule = cssRule(css, '.flower-chat-md-code-frame > .flower-chat-md-code-block');

    expect(blockRule).toContain("--flower-chat-md-code-font: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono'");
    expect(blockRule).not.toContain('Iosevka');
    expect(dividerRule).toContain('margin: 2em 0 1.25em');
    expect(dividerRule).toContain('var(--flower-chat-surface-border) 58%');
    expect(headingRule).toContain('margin: 1.5em 0 0.6em');
    expect(inlineCodeRule).toContain('background: var(--inline-code-background)');
    expect(inlineCodeRule).toContain('color: var(--inline-code-foreground)');
    expect(inlineCodeRule).toContain('border: 0');
    expect(inlineCodeRule).toContain('overflow-wrap: anywhere');
    expect(inlineCodeRule).toContain('box-decoration-break: clone');
    expect(inlineCodeRule).toContain('font-family: var(--flower-chat-md-code-font)');
    expect(inlineCodeRule).toContain('font-size: 0.96em');
    expect(inlineCodeRule).toContain('font-weight: 500');
    const assistantCodeRule = cssRule(css, '.flower-message-bubble-assistant .flower-chat-md-inline-code');
    expect(assistantCodeRule).toContain('color: var(--flower-reader-code)');
    expect(assistantCodeRule).toContain('font-size: 0.91em');
    expect(assistantCodeRule).toContain('font-weight: 400');
    expect(codeBlockRule).toContain('font-family: var(--flower-chat-md-code-font)');
    expect(codeBlockRule).toContain('font-size: 0.875em');
    expect(codeBlockRule).toContain('line-height: 1.65');
    expect(framedCodeBlockRule).toContain('margin-top: 0');
  });

  it('limits top-margin resets to the first rendered markdown block', () => {
    const css = flowerStyles();
    const resetSelectors = [
      '.flower-chat-md-block > .flower-chat-md-content > .flower-chat-md-committed-segment:first-child > :first-child',
      '.flower-chat-md-blockquote > :first-child',
      '.flower-chat-md-block li > :first-child',
    ];
    const rootResetRule = cssRule(css, resetSelectors.join(',\n'));

    expect(css).not.toContain('.flower-chat-md-block :first-child');
    expect(rootResetRule).toContain('margin-top: 0');
    for (const selector of resetSelectors) {
      expect(rootResetRule).toContain(selector);
    }
  });
});
