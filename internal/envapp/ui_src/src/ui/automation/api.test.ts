import { describe, expect, it } from 'vitest';
import {
  layoutNodes,
  descendants,
  reportDocument,
  type FlowNode,
  latestAttempts,
  type Run,
} from './api';
import { automationMessages, automationText } from './messages';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
const node = (id: string, depends_on: string[] = []): FlowNode => ({
  id,
  title: id,
  kind: 'agent',
  depends_on,
});
describe('workflow projection', () => {
  it('places dependencies before consumers irrespective of source ordering', () => {
    const values = layoutNodes([
      node('c', ['a', 'b']),
      node('b', ['a']),
      node('a'),
    ]);
    expect(values.find((n) => n.node.id === 'c')!.x).toBeGreaterThan(
      values.find((n) => n.node.id === 'b')!.x,
    );
    expect(
      descendants(
        values.map((n) => n.node),
        'b',
      ),
    ).toEqual(new Set(['b', 'c']));
  });
  it('retains stable item identities when attempts are retried', () => {
    const run = {
      attempts: [
        {
          id: 'old',
          node_id: 'n',
          item: { id: 'a' },
          number: 1,
          state: 'failed',
        },
        {
          id: 'b',
          node_id: 'n',
          item: { id: 'b' },
          number: 1,
          state: 'completed',
        },
        {
          id: 'retry',
          node_id: 'n',
          item: { id: 'a' },
          number: 2,
          state: 'completed',
        },
      ],
    } as Run;
    expect(latestAttempts(run, 'n').map((a) => a.id)).toEqual(['retry', 'b']);
  });
  it('sets a restrictive preview policy before untrusted HTML', () => {
    const doc = reportDocument('<script>parent.alert(1)</script>');
    expect(doc.indexOf('default-src')).toBeLessThan(doc.indexOf('<script>'));
    expect(doc).toContain("form-action 'none'");
  });
  it.each(SUPPORTED_LOCALES)(
    'has explicit complete automation messages in %s',
    (locale) => {
      const flatten = (value: object, prefix = ''): Record<string, string> =>
        Object.fromEntries(
          Object.entries(value).flatMap(([key, child]) => {
            const name = prefix ? `${prefix}.${key}` : key;
            return typeof child === 'string'
              ? [[name, child]]
              : Object.entries(flatten(child, name));
          }),
        );
      const base = flatten(automationMessages['en-US']);
      const actual = flatten(automationMessages[locale]);
      expect(Object.keys(actual).sort()).toEqual(Object.keys(base).sort());
      for (const [key, text] of Object.entries(base)) {
        expect(automationText(locale, key).trim()).not.toBe('');
        expect(actual[key].match(/\{[A-Za-z0-9_]+\}/g) ?? []).toEqual(
          text.match(/\{[A-Za-z0-9_]+\}/g) ?? [],
        );
      }
    },
  );
});
