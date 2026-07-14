// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from './localeMeta';
import { dictionaries, enUS } from './locales/testDictionaries';
import { PROTECTED_TERMS } from './protectedTerms';

type MessageLeaf = string | Readonly<Record<string, string>> | readonly unknown[];

const featureSections = ['codespaces', 'webServices'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPluralLike(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && typeof value.other === 'string';
}

function collectLeaves(value: unknown, prefix = ''): Readonly<Record<string, MessageLeaf>> {
  if (typeof value === 'string' || Array.isArray(value) || isPluralLike(value)) {
    return { [prefix]: value };
  }
  if (!isRecord(value)) {
    return {};
  }
  const entries: Record<string, MessageLeaf> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(entries, collectLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return entries;
}

function stringsForLeaf(value: MessageLeaf): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.map((part) => JSON.stringify(part));
  }
  return Object.values(value).filter((message): message is string => typeof message === 'string');
}

function placeholderSet(messages: readonly string[]): Set<string> {
  const placeholders = new Set<string>();
  for (const message of messages) {
    for (const match of message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      placeholders.add(match[1] ?? '');
    }
  }
  placeholders.delete('');
  return placeholders;
}

function expectSameSet(left: Set<string>, right: Set<string>): void {
  expect([...left].sort()).toEqual([...right].sort());
}

describe('Codespaces and Web Services i18n dictionaries', () => {
  it('keeps locale shape, placeholders, and protected terms aligned', () => {
    for (const section of featureSections) {
      const sourceLeaves = collectLeaves(enUS[section], section);
      const sourceKeys = Object.keys(sourceLeaves).sort();

      for (const locale of SUPPORTED_LOCALES) {
        const targetLeaves = collectLeaves(dictionaries[locale][section], section);
        expect(Object.keys(targetLeaves).sort()).toEqual(sourceKeys);

        for (const key of sourceKeys) {
          const source = sourceLeaves[key];
          const target = targetLeaves[key];
          expect(typeof target).toBe(typeof source);
          expectSameSet(
            placeholderSet(stringsForLeaf(source)),
            placeholderSet(stringsForLeaf(target)),
          );

          const sourceText = stringsForLeaf(source).join('\n');
          const targetText = stringsForLeaf(target).join('\n');
          for (const term of PROTECTED_TERMS) {
            if (sourceText.includes(term)) {
              expect(targetText, `${locale}.${key} should preserve ${term}`).toContain(term);
            }
          }
        }
      }
    }
  });
});
