import { describe, expect, it } from 'vitest';
import { mapFlowerActivitySummary } from './flowerLiveMapper';

describe('single-mutation summary titles', () => {
  const fields = [{ path: '/payload/mutations', kind: 'array', count: 1 }];
  it('retains bounded title facts without claiming that mutation details are loaded', () => {
    const values = { '/payload/mutations/0/display_name': 'panda-bicycle.html', '/payload/mutations/0/change_type': 'delete' };
    expect(mapFlowerActivitySummary({ fields, values })).toMatchObject({ fields, values });
  });
  it.each([
    { fields: [], values: { '/payload/mutations/0/display_name': 'missing-owner' } },
    { fields: [{ ...fields[0], count: 2 }], values: { '/payload/mutations/0/display_name': 'misleading-first' } },
    { fields, values: { '/payload/mutations/0/display_name': '🌸'.repeat(600) } },
    { fields, values: { '/payload/mutations/0/target': { path: '/unauthorized' } } },
    { fields, values: { '/payload/mutations/0/unified_diff': 'hidden' } },
  ])('rejects unowned or unbounded summary values', input => {
    expect(() => mapFlowerActivitySummary(input)).toThrow('invalid activity summary');
  });
});
