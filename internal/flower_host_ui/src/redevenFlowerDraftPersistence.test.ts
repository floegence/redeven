import { describe, expect, it, vi } from 'vitest';

import { createRedevenFlowerDraftPersistence } from './redevenFlowerDraftPersistence';

const draft = (revision: number, state = 'ordinary') => ({
  scope_id: 'thread/a',
  revision,
  value: { text: 'hello', attachments: [], references: [], mode: state },
  updated_at_unix_ms: 1_000 + revision,
  lease_id: 'lease-1',
  lease_holder_id: 'activity',
  lease_expires_at_unix_ms: 30_000,
});

const reference = (overrides: Record<string, unknown> = {}) => ({
  local_id: 'flower_ref_1',
  kind: 'file',
  path: '/workspace/main.ts',
  label: 'main.ts',
  ...overrides,
});

describe('Redeven Flower draft persistence', () => {
  it('owns the Redeven routes and wire mapping outside shared Flower UI', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(draft(1))
      .mockResolvedValueOnce({ state: 'owned', draft: draft(1) })
      .mockResolvedValueOnce({ state: 'owned', draft: draft(1) })
      .mockResolvedValueOnce({ state: 'committed', draft: draft(2) })
      .mockResolvedValueOnce({});
    const persistence = createRedevenFlowerDraftPersistence(request);

    expect((await persistence.load('thread/a')).revision).toBe(1);
    expect((await persistence.acquire('thread/a', 'activity', true)).state).toBe('owned');
    expect((await persistence.renew('thread/a', 'activity', 'lease-1')).state).toBe('owned');
    expect((await persistence.mutate('thread/a', 'activity', 'lease-1', 1, {
      text: 'next',
      attachments: [],
      references: [],
      mode: 'ordinary',
    })).kind).toBe('committed');
    await persistence.release('thread/a', 'activity', 'lease-1');

    const path = '/_redeven_proxy/api/ai/composer-drafts/thread%2Fa';
    expect(request.mock.calls).toEqual([
      ['GET', path],
      ['POST', `${path}/lease`, { action: 'take_over', holder_id: 'activity' }],
      ['POST', `${path}/lease`, { action: 'renew', holder_id: 'activity', lease_id: 'lease-1' }],
      ['PUT', path, {
        holder_id: 'activity',
        lease_id: 'lease-1',
        expected_revision: 1,
        value: { text: 'next', attachments: [], references: [], mode: 'ordinary' },
      }],
      ['POST', `${path}/lease`, { action: 'release', holder_id: 'activity', lease_id: 'lease-1' }],
    ]);
  });

  it.each([
    ['local id', [reference(), reference({ path: '/workspace/other.ts', label: 'other.ts' })]],
    ['path and kind', [reference(), reference({ local_id: 'flower_ref_2' })]],
  ])('rejects duplicate reference %s values from the host response', async (_field, references) => {
    const request = vi.fn(async () => ({
      ...draft(1),
      value: { text: '', attachments: [], references, mode: 'ordinary' },
    }));
    const persistence = createRedevenFlowerDraftPersistence(request);

    await expect(persistence.load('thread/a')).rejects.toThrow('Duplicate Flower composer draft reference.');
  });

  it('rejects a host draft response that omits the v7 references field', async () => {
    const request = vi.fn(async () => ({
      ...draft(1),
      value: { text: '', attachments: [], mode: 'ordinary' },
    }));
    const persistence = createRedevenFlowerDraftPersistence(request);

    await expect(persistence.load('thread/a')).rejects.toThrow('Invalid Flower composer draft references.');
  });

  it('rejects unknown fields in a host draft reference', async () => {
    const request = vi.fn(async () => ({
      ...draft(1),
      value: {
        text: '',
        attachments: [],
        references: [reference({ root_label: 'workspace' })],
        mode: 'ordinary',
      },
    }));
    const persistence = createRedevenFlowerDraftPersistence(request);

    await expect(persistence.load('thread/a')).rejects.toThrow('Invalid Flower composer draft reference.');
  });
});
