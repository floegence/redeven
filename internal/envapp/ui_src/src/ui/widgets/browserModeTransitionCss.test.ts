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
  it('keeps Files/Git shell chrome synchronous while only the mode thumb animates', () => {
    const css = readStyles();
    const inactivePanel = cssBlock(css, '.browser-mode-transition-panel');
    const activePanel = cssBlock(css, ".browser-mode-transition-panel[data-state='active']");
    const thumb = cssBlock(css, '.browser-mode-switch__thumb');

    expect(inactivePanel).toContain('opacity: 0;');
    expect(inactivePanel).toContain('visibility: hidden;');
    expect(inactivePanel).not.toContain('transition:');
    expect(activePanel).toContain('opacity: 1;');
    expect(activePanel).toContain('visibility: visible;');
    expect(activePanel).not.toContain('transition:');
    expect(thumb).toContain('transform 180ms');
  });
});
