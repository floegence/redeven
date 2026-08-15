import { describe, expect, it } from 'vitest';

import { canonicalFlowerThreadTitle } from './flowerThreadTitle';

describe('canonicalFlowerThreadTitle', () => {
  it('consumes canonical fallback titles in pending and failed states', () => {
    expect(canonicalFlowerThreadTitle({ title: ' Pending fallback ', title_status: 'pending' })).toBe('Pending fallback');
    expect(canonicalFlowerThreadTitle({ title: 'Failed fallback', title_status: 'failed' })).toBe('Failed fallback');
  });

  it('derives only legacy empty snapshots from the first user message', () => {
    expect(canonicalFlowerThreadTitle({
      title: '',
      title_status: 'failed',
      messages: [{
        id: 'user-1', role: 'user', content: '  inspect\n\tthe   runtime  ', status: 'complete', created_at_ms: 1,
      }],
    })).toBe('inspect the runtime');
    expect(canonicalFlowerThreadTitle({
      title: '',
      title_status: 'unset',
      messages: [{
        id: 'user-attachment', role: 'user', content: '', status: 'complete', created_at_ms: 1,
        references: [{ reference_id: 'attachment:1', kind: 'file', label: 'trace.json' }],
      }],
    })).toBe('trace.json');
  });

  it('uses the canonical 200-rune limit for legacy derivation', () => {
    expect(Array.from(canonicalFlowerThreadTitle({
      title: '',
      title_status: 'unset',
      messages: [{ id: 'user-1', role: 'user', content: '界'.repeat(220), status: 'complete', created_at_ms: 1 }],
    }))).toHaveLength(200);
  });
});
