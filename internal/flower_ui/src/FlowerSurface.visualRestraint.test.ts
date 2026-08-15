import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const css = fs.readFileSync(path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css'), 'utf8');
const threadList = fs.readFileSync(path.join(repoRoot, 'internal', 'flower_ui', 'src', 'threads', 'FlowerThreadList.tsx'), 'utf8');
const surface = fs.readFileSync(path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx'), 'utf8');

function cssRule(selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

function lastCssRule(selector: string): string {
  const matches = [...css.matchAll(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'gmu'))];
  const start = matches.at(-1)?.index ?? -1;
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

describe('Flower restrained selection and focus treatments', () => {
  it('uses only background and text contrast for the active thread', () => {
    const cardRule = cssRule('.flower-thread-card {');
    const activeRule = cssRule('.flower-thread-card-active,\n.flower-thread-card-active:hover {');
    const activeTitleRule = cssRule('.flower-thread-card-active .flower-thread-list-title {');

    expect(threadList).toContain("'flower-thread-card group relative w-full cursor-pointer rounded-lg'");
    expect(threadList).not.toContain("rounded-lg border'");
    expect(threadList).toContain('focus-visible:ring-2');
    expect(cardRule).toContain('border: 0');
    expect(activeRule).toContain('background: var(--flower-thread-rail-accent-strong)');
    expect(activeRule).not.toMatch(/border|outline|box-shadow|ring|inset/u);
    expect(activeTitleRule).toContain('color: color-mix');
  });

  it('does not alter composer border or shadow when text entry receives focus', () => {
    const composerRule = lastCssRule('.flower-composer {');
    const textareaFocusRule = cssRule('.flower-composer textarea,\n.flower-composer textarea:focus,');
    const collapsedComposerRule = cssRule('.flower-surface-companion-collapsed .flower-composer {');
    const collapsedFocusRule = cssRule('.flower-surface-companion-collapsed .flower-composer:focus-within {');

    expect(composerRule).toContain('border: 1px solid');
    expect(composerRule).toContain('box-shadow:');
    expect(css).not.toMatch(/^\.flower-composer:focus-within \{/gmu);
    expect(collapsedComposerRule).toContain('border: 0');
    expect(collapsedComposerRule).toContain('box-shadow: none');
    expect(collapsedFocusRule).toContain('border: 0');
    expect(collapsedFocusRule).toContain('box-shadow: none');
    expect(textareaFocusRule).toContain('outline: none');
    expect(textareaFocusRule).toContain('border: 0');
    expect(textareaFocusRule).toContain('box-shadow: none');
  });

  it('removes the disclosure guide only from Shell terminal details', () => {
    expect(surface).toContain("terminalDisclosure() && 'flower-activity-inline-details-content-terminal'");
    expect(cssRule('.flower-activity-inline-details-content {')).toContain('border-left: 1px solid');
    expect(cssRule('.flower-activity-inline-details-content-terminal {')).toContain('border-left: 0');
  });
});
