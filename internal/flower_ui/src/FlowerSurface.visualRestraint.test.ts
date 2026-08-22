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

  it('keeps the collapsed bottom-bar thread title compact and secondary to the composer', () => {
    const titleRule = cssRule('.flower-surface-companion-collapsed .flower-companion-thread-trigger {');
    const switcherRule = cssRule('.flower-surface-companion-collapsed .flower-companion-collapsed-thread-switcher {');
    const emptySwitcherRule = cssRule('.flower-surface-companion-collapsed .flower-companion-collapsed-thread-switcher[data-flower-companion-empty-selection=\'true\'] {');
    const emptyTriggerRule = cssRule('.flower-surface-companion-collapsed .flower-companion-thread-trigger[data-flower-companion-empty-selection=\'true\'] {');

    expect(surface).toContain(': selectedThreadTitle()}');
    expect(surface).toContain('data-flower-companion-empty-selection={companionCollapsedEmptySelection() ? \'true\' : undefined}');
    expect(titleRule).toContain('height: 1.5rem');
    expect(titleRule).toContain('font-size: 0.6875rem');
    expect(titleRule).toContain('font-weight: 500');
    expect(titleRule).toContain('color: color-mix');
    expect(cssRule('.flower-surface-companion-collapsed .flower-companion-thread-trigger-icon {')).toContain('width: 0.875rem');
    expect(cssRule('.flower-surface-companion-collapsed .flower-companion-thread-trigger-chevron {')).toContain('width: 0.75rem');
    expect(switcherRule).toContain('flex: 0 1 11rem');
    expect(switcherRule).toContain('max-width: min(11rem, 34%)');
    expect(emptySwitcherRule).toContain('flex: 0 0 auto');
    expect(emptySwitcherRule).toContain('width: 1.5rem');
    expect(emptySwitcherRule).toContain('max-width: 1.5rem');
    expect(emptyTriggerRule).toContain('justify-content: center');
    expect(emptyTriggerRule).toContain('gap: 0');
    expect(emptyTriggerRule).toContain('padding: 0');
    expect(css).toContain('flex-basis: 7.5rem');
  });
});
