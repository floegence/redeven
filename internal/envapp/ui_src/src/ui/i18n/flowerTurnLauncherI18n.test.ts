import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from './localeMeta';
import { dictionaries, enUS } from './locales';
import { PROTECTED_TERMS } from './protectedTerms';

type StringLeaves = Readonly<Record<string, string>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectStringLeaves(value: unknown, prefix = ''): StringLeaves {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }
  if (!isRecord(value)) {
    return {};
  }

  const entries: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(entries, collectStringLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return entries;
}

function placeholderSet(message: string): Set<string> {
  const placeholders = new Set<string>();
  for (const match of message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    placeholders.add(match[1] ?? '');
  }
  placeholders.delete('');
  return placeholders;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

describe('Flower turn launcher i18n dictionaries', () => {
  it('keeps launcher locale shape, placeholders, and protected terms aligned', () => {
    const sourceLeaves = collectStringLeaves(enUS.flowerTurnLauncher);
    const sourceKeys = Object.keys(sourceLeaves).sort();

    for (const locale of SUPPORTED_LOCALES) {
      const targetLeaves = collectStringLeaves(dictionaries[locale].flowerTurnLauncher);
      expect(Object.keys(targetLeaves).sort()).toEqual(sourceKeys);

      for (const key of sourceKeys) {
        expect(sameSet(
          placeholderSet(sourceLeaves[key] ?? ''),
          placeholderSet(targetLeaves[key] ?? ''),
        )).toBe(true);

        for (const term of PROTECTED_TERMS) {
          if ((sourceLeaves[key] ?? '').includes(term)) {
            expect(targetLeaves[key]).toContain(term);
          }
        }
      }
    }
  });
});
