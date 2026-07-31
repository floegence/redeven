import { describe, expect, it, vi } from 'vitest';

import { createFlowerComposerDraftCoordinator } from './createFlowerComposerDraftCoordinator';

describe('createFlowerComposerDraftCoordinator', () => {
  it('shares one connection-local draft between sessions for the same scope', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const activity = coordinator.open('thread-1');
    const workbench = coordinator.open('thread-1');
    const listener = vi.fn();
    workbench.subscribe(listener);

    const result = activity.mutate((draft) => ({ ...draft, text: 'shared text' }));

    expect(result).toMatchObject({ kind: 'committed', snapshot: { revision: 1 } });
    expect(workbench.snapshot().value.text).toBe('shared text');
    expect(listener).toHaveBeenLastCalledWith(result.snapshot);
  });

  it('isolates drafts in different scopes', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    coordinator.open('thread-a').mutate((draft) => ({ ...draft, text: 'alpha' }));
    coordinator.open('thread-b').mutate((draft) => ({ ...draft, text: 'beta' }));

    expect(coordinator.read('thread-a').value.text).toBe('alpha');
    expect(coordinator.read('thread-b').value.text).toBe('beta');
  });

  it('isolates the same thread across separate connection coordinators', () => {
    const firstConnection = createFlowerComposerDraftCoordinator();
    const secondConnection = createFlowerComposerDraftCoordinator();
    firstConnection.open('thread-1').mutate((draft) => ({ ...draft, text: 'first connection only' }));

    expect(firstConnection.read('thread-1').value.text).toBe('first connection only');
    expect(secondConnection.read('thread-1').value.text).toBe('');
  });

  it('applies mutations atomically in call order', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const session = coordinator.open('thread-1');

    session.mutate((draft) => ({ ...draft, text: `${draft.text}a` }));
    session.mutate((draft) => ({ ...draft, text: `${draft.text}b` }));
    session.mutate((draft) => ({ ...draft, text: `${draft.text}c` }));

    expect(session.snapshot()).toMatchObject({ revision: 3, value: { text: 'abc' } });
  });

  it('clears the complete scope value and notifies every session', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const first = coordinator.open('thread-1');
    const second = coordinator.open('thread-1');
    const listener = vi.fn();
    second.subscribe(listener);
    first.mutate((draft) => ({
      ...draft,
      text: 'message',
      references: [{ local_id: 'ref-1', kind: 'file', path: '/tmp/a', label: 'a' }],
    }));

    const result = second.clear();

    expect(result.snapshot.value).toEqual({ text: '', attachments: [], references: [], mode: 'ordinary' });
    expect(first.snapshot()).toBe(result.snapshot);
    expect(listener).toHaveBeenLastCalledWith(result.snapshot);
  });

  it('moves a pending new-thread scope to its admitted thread identity', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const pending = coordinator.open('');
    const listener = vi.fn();
    pending.subscribe(listener);
    pending.mutate((draft) => ({ ...draft, text: 'preserved' }));

    const moved = coordinator.moveScope('', 'thread-created');

    expect(moved).toMatchObject({ scope_id: 'thread-created', value: { text: 'preserved' } });
    expect(coordinator.open('thread-created').snapshot()).toBe(moved);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      scope_id: '__new_thread__',
      value: expect.objectContaining({ text: '' }),
    }));
    expect(coordinator.read('').value.text).toBe('');
  });

  it('transfers into an opened target while resetting the pending source for other surfaces', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const pending = coordinator.open('');
    const admitted = coordinator.open('thread-created');
    const admittedListener = vi.fn();
    admitted.subscribe(admittedListener);
    pending.mutate((draft) => ({ ...draft, text: 'connection draft' }));

    const moved = coordinator.moveScope('', 'thread-created');
    admitted.mutate((draft) => ({ ...draft, text: `${draft.text} shared` }));

    expect(moved.value.text).toBe('connection draft');
    expect(pending.snapshot().value.text).toBe('');
    expect(admitted.snapshot().value.text).toBe('connection draft shared');
    expect(admitted.snapshot()).not.toBe(pending.snapshot());
    expect(admittedListener).toHaveBeenLastCalledWith(admitted.snapshot());
  });

  it('keeps source and target sessions independent after a transfer', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const pending = coordinator.open('');
    const admitted = coordinator.open('thread-created');
    pending.mutate((draft) => ({ ...draft, text: 'admitted message' }));

    coordinator.moveScope('', 'thread-created');
    pending.mutate((draft) => ({ ...draft, text: 'next message' }));

    expect(pending.snapshot().value.text).toBe('next message');
    expect(admitted.snapshot().value.text).toBe('admitted message');
  });

  it('shares one attachment staging capability across surfaces and releases it with the connection', async () => {
    const coordinator = createFlowerComposerDraftCoordinator({ now: () => 100 });
    const create = vi.fn(async () => ({
      staging_scope_id: 'staging-scope-1',
      target_id: 'thread-1',
      capability: 'connection-secret',
      expires_at_unix_ms: 10_000,
    }));
    const release = vi.fn(async () => undefined);

    const [activityScope, workbenchScope] = await Promise.all([
      coordinator.ensureAttachmentStagingScope('thread-1', create, release),
      coordinator.ensureAttachmentStagingScope('thread-1', create, release),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(workbenchScope).toBe(activityScope);
    expect(coordinator.attachmentStagingScope('thread-1')).toBe(activityScope);

    coordinator.dispose();

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(activityScope);
  });

  it('moves the connection-local staging capability with a new-thread scope', async () => {
    const coordinator = createFlowerComposerDraftCoordinator({ now: () => 100 });
    const stagingScope = {
      staging_scope_id: 'staging-scope-new',
      target_id: 'client-create',
      capability: 'connection-secret',
      expires_at_unix_ms: 10_000,
    };
    await coordinator.ensureAttachmentStagingScope('', async () => stagingScope, async () => undefined);

    coordinator.moveScope('', 'thread-created');

    expect(coordinator.attachmentStagingScope('thread-created')).toBe(stagingScope);
    expect(coordinator.attachmentStagingScope('')).toBeNull();
  });

  it('settles a pending staging creation into the moved target scope', async () => {
    const coordinator = createFlowerComposerDraftCoordinator({ now: () => 100 });
    let resolveCreation!: (scope: {
      staging_scope_id: string;
      target_id: string;
      capability: string;
      expires_at_unix_ms: number;
    }) => void;
    const release = vi.fn(async () => undefined);
    const creation = coordinator.ensureAttachmentStagingScope('', () => new Promise((resolve) => {
      resolveCreation = resolve;
    }), release);

    coordinator.moveScope('', 'thread-created');
    const stagingScope = {
      staging_scope_id: 'staging-scope-moved-pending',
      target_id: 'client-create',
      capability: 'connection-secret',
      expires_at_unix_ms: 10_000,
    };
    resolveCreation(stagingScope);

    await expect(creation).resolves.toBe(stagingScope);
    expect(coordinator.attachmentStagingScope('thread-created')).toBe(stagingScope);
    expect(coordinator.attachmentStagingScope('')).toBeNull();
    coordinator.releaseAttachmentStagingScope('thread-created');
    expect(release).toHaveBeenCalledWith(stagingScope);
  });

  it('releases an expiring scope and deduplicates its concurrent refresh', async () => {
    let now = 100;
    const coordinator = createFlowerComposerDraftCoordinator({ now: () => now });
    const scopes = [
      {
        staging_scope_id: 'staging-scope-old', target_id: 'thread-1', capability: 'old-secret',
        expires_at_unix_ms: 6_000,
      },
      {
        staging_scope_id: 'staging-scope-new', target_id: 'thread-1', capability: 'new-secret',
        expires_at_unix_ms: 20_000,
      },
    ];
    const create = vi.fn(async () => scopes.shift()!);
    const release = vi.fn(async () => undefined);
    const oldScope = await coordinator.ensureAttachmentStagingScope('thread-1', create, release);
    now = 1_001;

    const [activityScope, workbenchScope] = await Promise.all([
      coordinator.ensureAttachmentStagingScope('thread-1', create, release),
      coordinator.ensureAttachmentStagingScope('thread-1', create, release),
    ]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(oldScope);
    expect(workbenchScope).toBe(activityScope);
    expect(activityScope.staging_scope_id).toBe('staging-scope-new');
  });

  it('rejects reads and mutations after disposal', () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const session = coordinator.open('thread-1');
    coordinator.dispose();

    expect(() => session.mutate((draft) => draft)).toThrow(/disposed/i);
    expect(() => session.clear()).toThrow(/disposed/i);
    expect(() => coordinator.read('thread-1')).toThrow(/disposed/i);
    expect(() => coordinator.open('thread-1')).toThrow(/disposed/i);
    expect(() => coordinator.moveScope('thread-1', 'thread-2')).toThrow(/disposed/i);
  });
});
