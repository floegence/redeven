import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readStyles(): string {
  const here = fileURLToPath(import.meta.url);
  return fs.readFileSync(path.resolve(path.dirname(here), '../../styles/redeven.css'), 'utf8');
}

function cssBlock(source: string, selector: string): string {
  const index = source.indexOf(selector);
  if (index < 0) return '';
  const start = source.indexOf('{', index);
  if (start < 0) return '';
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, cursor);
    }
  }
  return '';
}

describe('browser mode transition css', () => {
  it('keeps Files/Git shell chrome and selected faces synchronous', () => {
    const css = readStyles();
    const inactivePanel = cssBlock(css, '.browser-mode-transition-panel');
    const activePanel = cssBlock(css, ".browser-mode-transition-panel[data-state='active']");
    const selection = cssBlock(css, '.redeven-surface-segmented__item {');

    expect(inactivePanel).toContain('opacity: 0;');
    expect(inactivePanel).toContain('visibility: hidden;');
    expect(inactivePanel).not.toContain('transition:');
    expect(activePanel).toContain('opacity: 1;');
    expect(activePanel).toContain('visibility: visible;');
    expect(activePanel).not.toContain('transition:');
    expect(selection).toContain('transition: none;');
    expect(css).not.toContain('.browser-mode-switch__thumb');
  });
});
