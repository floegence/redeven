import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function readCompanionCss(): string {
  const here = fileURLToPath(import.meta.url);
  return fs.readFileSync(path.resolve(path.dirname(here), './activity-flower-shell.css'), 'utf8');
}

type CssRule = Readonly<{
  selectors: string;
  body: string;
}>;

function companionRules(src: string): readonly CssRule[] {
  const start = src.indexOf('.flower-activity-companion {');
  const end = src.indexOf('.flower-activity-companion-icon-button {');
  if (start < 0 || end < 0 || end <= start) throw new Error('Flower companion CSS section is missing.');
  return [...src.slice(start, end).matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selectors: match[1].trim(),
    body: match[2].trim(),
  }));
}

function findRule(rules: readonly CssRule[], selectorFragment: string): CssRule {
  const rule = rules.find((candidate) => candidate.selectors.includes(selectorFragment));
  if (!rule) throw new Error(`Missing Flower companion CSS rule: ${selectorFragment}`);
  return rule;
}

function expectDrawerPhases(rule: CssRule): void {
  expect(rule.selectors).toContain("[data-companion-phase='expanding']");
  expect(rule.selectors).toContain("[data-companion-phase='expanded']");
  expect(rule.selectors).toContain("[data-companion-phase='collapsing']");
  expect(rule.selectors).not.toContain("[data-companion-phase='collapsed']");
}

describe('Flower bottom companion visual contract', () => {
  it('keeps calm expanded styling through the collapse transition', () => {
    const rules = companionRules(readCompanionCss());
    const frameRule = findRule(rules, '.flower-activity-companion.floe-bottom-bar-companion');

    expectDrawerPhases(frameRule);
    expect(frameRule.body).toContain('background: var(--flower-companion-surface);');
    expect(frameRule.body.match(/var\(--redeven-surface-shadow-source\)/gu)).toHaveLength(2);
    expect(frameRule.body).not.toContain('var(--foreground)');
  });

  it('scopes every drawer child treatment to non-collapsed phases', () => {
    const rules = companionRules(readCompanionCss());
    const childRules = rules.filter((rule) => rule.selectors.includes(') .flower-'));

    expect(childRules.length).toBeGreaterThan(0);
    for (const rule of childRules) {
      expect(rule.selectors).toContain('.flower-activity-companion:is(');
      expectDrawerPhases(rule);
    }
  });

  it('removes inherited glow while retaining one shared accessible focus rule', () => {
    const rules = companionRules(readCompanionCss());
    const dockGlowRule = findRule(rules, '.flower-chat-bottom-dock::before');
    const composerRule = findRule(rules, ') .flower-composer');
    const focusRule = findRule(rules, '.flower-composer:focus-within');

    expect(dockGlowRule.body).toBe('box-shadow: none;');
    expect(composerRule.body).toContain('backdrop-filter: none;');
    expect(composerRule.body).toContain('var(--redeven-surface-shadow-source)');
    expect(composerRule.body).not.toContain('var(--foreground)');
    expect(focusRule.selectors).toContain('.flower-composer:focus-within');
    expect(focusRule.selectors).toContain(".flower-composer[data-flower-approval-handoff='true']");
    expect(focusRule.body).toContain('0 0 0 2px color-mix(in srgb, var(--ring) 72%');
    expect(focusRule.body).toContain('var(--redeven-surface-shadow-source)');
    expect(focusRule.body).not.toContain('var(--foreground)');
  });
});
