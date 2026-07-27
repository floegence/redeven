import { describe, expect, it, vi } from 'vitest';

import {
  createFlowerComposerDraftCoordinator,
  type FlowerComposerDraftLease,
  type FlowerComposerDraftPersistence,
  type FlowerComposerDraftSnapshot,
  type FlowerComposerDraftValue,
} from './createFlowerComposerDraftCoordinator';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const draftValue = (overrides: Partial<FlowerComposerDraftValue> = {}): FlowerComposerDraftValue => ({
  text: '',
  attachments: [],
  references: [],
  mode: 'ordinary',
  ...overrides,
});

const draftSnapshot = (
  revision: number,
  value: FlowerComposerDraftValue = draftValue(),
  lease?: FlowerComposerDraftLease,
): FlowerComposerDraftSnapshot => ({
  scope_id: 'thread-1',
  revision,
  value,
  updated_at_unix_ms: 1_000 + revision,
  ...(lease ? { lease } : {}),
});

const ownedLease = (
  expiresAt = Date.now() + 30_000,
  holderID = 'activity',
): FlowerComposerDraftLease => ({
  lease_id: 'lease-secret',
  scope_id: 'thread-1',
  holder_id: holderID,
  acquired_revision: 0,
  expires_at_unix_ms: expiresAt,
});

function persistenceWith(
  overrides: Partial<FlowerComposerDraftPersistence> = {},
): FlowerComposerDraftPersistence {
  const lease = ownedLease();
  return {
    load: async () => draftSnapshot(0),
    acquire: async () => ({ state: 'owned', snapshot: draftSnapshot(0, draftValue(), lease), lease }),
    renew: async () => ({ state: 'owned', snapshot: draftSnapshot(0, draftValue(), lease), lease }),
    mutate: async (_scopeID, _holderID, _leaseID, expectedRevision, value) => ({
      kind: 'committed',
      snapshot: draftSnapshot(expectedRevision + 1, value, lease),
    }),
    release: async () => undefined,
    ...overrides,
  };
}

describe('createFlowerComposerDraftCoordinator', () => {
  it('does not acquire a lease merely by opening or reading a draft', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    expect(activity.leaseState()).toEqual({ kind: 'lease_available' });
    expect(workbench.leaseState()).toEqual({ kind: 'lease_available' });
    expect(coordinator.read('thread-1').revision).toBe(0);
  });

  it('serializes first mutation ownership and exposes the shared projection', async () => {
    const coordinator = createFlowerComposerDraftCoordinator({ createLeaseID: () => 'lease-1' });
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    expect((await activity.acquire()).kind).toBe('lease_owned');
    expect(await workbench.acquire()).toMatchObject({ kind: 'lease_conflict', holder_id: 'activity' });

    const committed = await activity.mutate(0, (draft) => ({ ...draft, text: 'shared draft' }));
    expect(committed.kind).toBe('committed');
    expect(workbench.snapshot()).toMatchObject({
      revision: 1,
      value: { text: 'shared draft' },
    });
  });

  it('offers an atomic first-mutation acquire for synchronous composer input', () => {
    const coordinator = createFlowerComposerDraftCoordinator({ createLeaseID: () => 'lease-1' });
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    expect(activity.tryAcquire().kind).toBe('lease_owned');
    expect(workbench.tryAcquire()).toMatchObject({ kind: 'lease_conflict', holder_id: 'activity' });
  });

  it('rejects stale revisions and lets takeover continue from the latest shared revision', async () => {
    let leaseID = 0;
    const coordinator = createFlowerComposerDraftCoordinator({ createLeaseID: () => `lease-${++leaseID}` });
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    await activity.acquire();
    await activity.mutate(0, (draft) => ({ ...draft, text: 'activity edit' }));

    expect((await activity.mutate(0, (draft) => ({ ...draft, text: 'stale' }))).kind).toBe('revision_conflict');
    expect((await workbench.takeOver()).kind).toBe('lease_owned');
    expect((await activity.mutate(1, (draft) => ({ ...draft, text: 'late activity write' }))).kind).toBe('lease_lost');
    await workbench.mutate(1, (draft) => ({ ...draft, text: `${draft.text} + workbench` }));
    expect(coordinator.read('thread-1').value.text).toBe('activity edit + workbench');
  });

  it('rejects takeover while long-text preparation or turn admission owns the draft', async () => {
    let leaseID = 0;
    const coordinator = createFlowerComposerDraftCoordinator({ createLeaseID: () => `lease-${++leaseID}` });
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    await activity.acquire();
    await activity.mutate(0, (draft) => ({
      ...draft,
      mode: 'preparing_long_text_submission',
      proposed_turn_id: 'turn-1',
    }));
    expect(await workbench.takeOver()).toMatchObject({ kind: 'lease_conflict', holder_id: 'activity' });

    await activity.mutate(1, (draft) => ({ ...draft, mode: 'admission_in_flight' }));
    expect(await workbench.takeOver()).toMatchObject({ kind: 'lease_conflict', holder_id: 'activity' });
    expect(coordinator.read('thread-1').value.proposed_turn_id).toBe('turn-1');
  });

  it('keeps an admission lease bounded while explicit renewal makes progress', async () => {
    let now = 1_000;
    const coordinator = createFlowerComposerDraftCoordinator({ now: () => now, leaseDurationMS: 1_000 });
    const activity = coordinator.open('thread-1', 'activity');
    await activity.acquire();
    await activity.mutate(0, (draft) => ({ ...draft, mode: 'admission_in_flight', proposed_turn_id: 'turn-1' }));
    now = 1_500;
    expect((await activity.renew()).kind).toBe('lease_owned');
    now = 2_200;
    expect(activity.leaseState().kind).toBe('lease_owned');
    expect((await coordinator.open('thread-1', 'workbench').acquire()).kind).toBe('lease_conflict');
    now = 2_600;
    expect(coordinator.open('thread-1', 'workbench').leaseState().kind).toBe('lease_available');
  });

  it('does not grant a takeover when the draft enters admission during its await boundary', async () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const activity = coordinator.open('thread-1', 'activity');
    const workbench = coordinator.open('thread-1', 'workbench');
    await activity.acquire();
    const takeover = workbench.takeOver();
    await activity.mutate(0, (draft) => ({ ...draft, mode: 'admission_in_flight', proposed_turn_id: 'turn-1' }));
    expect(await takeover).toMatchObject({ kind: 'lease_conflict', holder_id: 'activity' });
    expect(activity.leaseState().kind).toBe('lease_owned');
  });

  it('releases expired leases without creating a module singleton', async () => {
    let now = 1_000;
    const first = createFlowerComposerDraftCoordinator({ now: () => now, leaseDurationMS: 1_000 });
    const second = createFlowerComposerDraftCoordinator({ now: () => now, leaseDurationMS: 1_000 });
    await first.open('thread-1', 'activity').acquire();
    expect(second.open('thread-1', 'workbench').leaseState()).toEqual({ kind: 'lease_available' });
    now = 2_001;
    expect(first.open('thread-1', 'workbench').leaseState()).toEqual({ kind: 'lease_available' });
  });

  it('reports an unavailable store distinctly and recovers on the next acquire', async () => {
    const lease = ownedLease();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(draftSnapshot(2, draftValue({ text: 'server draft' })));
    const coordinator = createFlowerComposerDraftCoordinator({
      now: () => 1_000,
      persistence: persistenceWith({
        load,
        acquire: async () => ({
          state: 'owned',
          snapshot: draftSnapshot(2, draftValue({ text: 'server draft' }), lease),
          lease,
        }),
      }),
    });
    const session = coordinator.open('thread-1', 'activity');
    await vi.waitFor(() => expect(session.leaseState()).toEqual({ kind: 'store_unavailable', unsaved: false }));

    expect(await session.acquire()).toMatchObject({ kind: 'lease_owned', lease: { lease_id: 'lease-secret' } });
    expect(session.snapshot()).toMatchObject({ revision: 2, value: { text: 'server draft' } });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps a redacted persistent lease conflict stable until explicit takeover', async () => {
    const lease = ownedLease(Date.now() + 30_000, 'workbench');
    const acquire = vi.fn()
      .mockResolvedValueOnce({
        state: 'conflict' as const,
        snapshot: draftSnapshot(4, draftValue({ text: 'shared draft' })),
        holderID: 'another_surface',
      })
      .mockResolvedValueOnce({
        state: 'owned' as const,
        snapshot: draftSnapshot(4, draftValue({ text: 'shared draft' }), lease),
        lease,
      });
    const coordinator = createFlowerComposerDraftCoordinator({
      persistence: persistenceWith({ acquire }),
    });
    const session = coordinator.open('thread-1', 'workbench');

    await expect(session.acquire()).resolves.toMatchObject({
      kind: 'lease_conflict',
      holder_id: 'another_surface',
    });
    expect(session.leaseState()).toMatchObject({
      kind: 'lease_conflict',
      holder_id: 'another_surface',
    });
    expect(session.tryAcquire()).toMatchObject({ kind: 'lease_conflict' });
    expect(acquire).toHaveBeenCalledTimes(1);

    await expect(session.takeOver()).resolves.toMatchObject({
      kind: 'lease_owned',
      lease: { lease_id: 'lease-secret' },
    });
    expect(session.leaseState()).toMatchObject({ kind: 'lease_owned' });
    expect(acquire).toHaveBeenLastCalledWith('thread-1', 'workbench', true);
  });

  it('keeps a redacted conflict stable when background polling returns a lease-redacted snapshot', async () => {
    vi.useFakeTimers();
    let unsubscribe: () => void = () => undefined;
    try {
      const lease = ownedLease(Date.now() + 30_000, 'workbench');
      const load = vi.fn(async () => draftSnapshot(4, draftValue({ text: 'shared draft' })));
      const acquire = vi.fn()
        .mockResolvedValueOnce({
          state: 'conflict' as const,
          snapshot: draftSnapshot(4, draftValue({ text: 'shared draft' })),
          holderID: 'another_surface',
        })
        .mockResolvedValueOnce({
          state: 'owned' as const,
          snapshot: draftSnapshot(4, draftValue({ text: 'shared draft' }), lease),
          lease,
        });
      const coordinator = createFlowerComposerDraftCoordinator({
        persistence: persistenceWith({ load, acquire }),
      });
      const session = coordinator.open('thread-1', 'workbench');
      unsubscribe = session.subscribe(() => undefined);

      await expect(session.acquire()).resolves.toMatchObject({ kind: 'lease_conflict' });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(load).toHaveBeenCalledTimes(2);
      expect(session.leaseState()).toMatchObject({
        kind: 'lease_conflict',
        holder_id: 'another_surface',
      });

      await expect(session.takeOver()).resolves.toMatchObject({ kind: 'lease_owned' });
      expect(session.leaseState()).toMatchObject({ kind: 'lease_owned' });
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it('keeps the lease bearer and unsaved projection when renew or mutation transport fails', async () => {
    const lease = ownedLease();
    const mutate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(
      async (_scopeID, _holderID, _leaseID, expectedRevision: number, value: FlowerComposerDraftValue) => ({
        kind: 'committed' as const,
        snapshot: draftSnapshot(expectedRevision + 1, value, lease),
      }),
    );
    const renew = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ state: 'owned' as const, snapshot: draftSnapshot(0), lease });
    const coordinator = createFlowerComposerDraftCoordinator({
      now: () => 1_000,
      persistence: persistenceWith({ mutate, renew }),
    });
    const session = coordinator.open('thread-1', 'activity');
    await session.acquire();

    expect(await session.mutate(0, (value) => ({ ...value, text: 'kept locally' }))).toMatchObject({
      kind: 'store_unavailable',
      unsaved: true,
    });
    expect(session.snapshot().value.text).toBe('kept locally');
    expect(session.leaseState()).toMatchObject({
      kind: 'lease_owned',
      lease: { lease_id: 'lease-secret' },
      persistence: 'store_unavailable',
      unsaved: true,
    });

    expect(await session.renew()).toMatchObject({
      kind: 'lease_owned',
      lease: { lease_id: 'lease-secret' },
      persistence: 'store_unavailable',
      unsaved: true,
    });
    expect(await session.renew()).toMatchObject({ kind: 'lease_owned', lease: { lease_id: 'lease-secret' } });
    expect(session.snapshot()).toMatchObject({ revision: 1, value: { text: 'kept locally' } });
    expect(session.leaseState()).not.toHaveProperty('persistence');
    expect(mutate).toHaveBeenLastCalledWith('thread-1', 'activity', 'lease-secret', 0, expect.objectContaining({ text: 'kept locally' }));
  });

  it('coalesces rapid typing through the serialized queue without losing the latest text', async () => {
    const persisted: string[] = [];
    const coordinator = createFlowerComposerDraftCoordinator({
      now: () => 1_000,
      persistence: persistenceWith({
        mutate: async (_scopeID, _holderID, _leaseID, expectedRevision, value) => {
          persisted.push(value.text);
          return {
            kind: 'committed',
            snapshot: draftSnapshot(expectedRevision + 1, value, ownedLease()),
          };
        },
      }),
    });
    const session = coordinator.open('thread-1', 'activity');
    await session.acquire();

    const first = session.mutate(0, (value) => ({ ...value, text: 'h' }));
    const second = session.mutate(0, (value) => ({ ...value, text: 'he' }));
    const third = session.mutate(0, (value) => ({ ...value, text: 'hello' }));
    expect(session.snapshot().value.text).toBe('hello');

    await Promise.all([first, second, third]);
    expect(persisted).toEqual(['h', 'he', 'hello']);
    expect(session.snapshot()).toMatchObject({ revision: 3, value: { text: 'hello' } });
  });

  it('serializes concurrent text and attachment changes without dropping either intent', async () => {
    const lease = ownedLease();
    const firstResponse = deferred<Awaited<ReturnType<FlowerComposerDraftPersistence['mutate']>>>();
    const secondResponse = deferred<Awaited<ReturnType<FlowerComposerDraftPersistence['mutate']>>>();
    const mutate = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const coordinator = createFlowerComposerDraftCoordinator({
      now: () => 1_000,
      persistence: persistenceWith({ mutate }),
    });
    const session = coordinator.open('thread-1', 'activity');
    await session.acquire();

    const typing = session.mutate(0, (value) => ({ ...value, text: 'hello' }));
    const attachment = session.mutate(0, (value) => ({
      ...value,
      attachments: [{
        local_id: 'local-1',
        source: 'file',
        name: 'notes.txt',
        mime_type: 'text/plain',
        size_bytes: 12,
        upload_request_id: 'upload-1',
        attempt_state: 'ready',
      }],
    }));
    expect(session.snapshot().value).toMatchObject({ text: 'hello', attachments: [{ local_id: 'local-1' }] });
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0]?.[3]).toBe(0);
    expect(mutate.mock.calls[0]?.[4]).toMatchObject({ text: 'hello', attachments: [] });

    firstResponse.resolve({ kind: 'committed', snapshot: draftSnapshot(1, draftValue({ text: 'hello' }), lease) });
    await expect(typing).resolves.toMatchObject({ kind: 'committed' });
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1]?.[3]).toBe(1);
    expect(mutate.mock.calls[1]?.[4]).toMatchObject({ text: 'hello', attachments: [{ local_id: 'local-1' }] });

    secondResponse.resolve({
      kind: 'committed',
      snapshot: draftSnapshot(2, mutate.mock.calls[1]![4] as FlowerComposerDraftValue, lease),
    });
    await expect(attachment).resolves.toMatchObject({ kind: 'committed' });
    expect(session.snapshot()).toMatchObject({
      revision: 2,
      value: { text: 'hello', attachments: [{ local_id: 'local-1' }] },
    });
  });

  it('does not let a deferred old renew snapshot overwrite a newer local intent', async () => {
    const lease = ownedLease();
    const renewResponse = deferred<Awaited<ReturnType<FlowerComposerDraftPersistence['renew']>>>();
    const mutate = vi.fn(async (_scopeID, _holderID, _leaseID, expectedRevision: number, value: FlowerComposerDraftValue) => ({
      kind: 'committed' as const,
      snapshot: draftSnapshot(expectedRevision + 1, value, lease),
    }));
    const coordinator = createFlowerComposerDraftCoordinator({
      now: () => 1_000,
      persistence: persistenceWith({ renew: () => renewResponse.promise, mutate }),
    });
    const session = coordinator.open('thread-1', 'activity');
    await session.acquire();

    const renewing = session.renew();
    const typing = session.mutate(0, (value) => ({ ...value, text: 'new local text' }));
    expect(session.snapshot().value.text).toBe('new local text');
    renewResponse.resolve({ state: 'owned', snapshot: draftSnapshot(0, draftValue({ text: 'old server text' })), lease });
    await renewing;
    expect(session.snapshot().value.text).toBe('new local text');
    await typing;
    expect(mutate).toHaveBeenCalledWith(
      'thread-1',
      'activity',
      'lease-secret',
      0,
      expect.objectContaining({ text: 'new local text' }),
    );
    expect(session.snapshot()).toMatchObject({ revision: 1, value: { text: 'new local text' } });
  });
});
