import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerConversationPreferenceClient, prepareFlowerNewConversationInput } from './conversationPreferences';
import type { FlowerConversationPreferences, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';

describe('Flower explicit preference writes', () => {
  afterEach(() => vi.useRealTimers());
  it('freezes one-shot launch fields without mutating memory and leaves existing threads alone', async () => {
    const preferences: FlowerConversationPreferences = { revision: 1, model_id: 'provider/a', working_dir: '/remembered', reasoning_by_model: { 'provider/a': { level: 'default', budget_tokens: 4096 } } };
    let snapshot: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: null, provider_secrets: [], conversation_preferences: preferences };
    const source = { loadSettings: vi.fn(async () => snapshot), getWorkingDirectoryPathContext: vi.fn(async () => ({ agentHomePathAbs: '/home', homePathAbs: '/home', defaultRootId: 'home', roots: [] })) };
    const prepared = await prepareFlowerNewConversationInput(source, { client_request_id: 'one-shot', prompt: 'inspect', working_dir: '/once' });
    snapshot = { ...snapshot, conversation_preferences: { ...preferences, model_id: 'provider/b', reasoning_by_model: { 'provider/a': { level: 'off' } } } };
    expect(prepared).toMatchObject({ model_id: 'provider/a', working_dir: '/once', reasoning_selection: { level: 'default', budget_tokens: 4096 } });
    expect(preferences.working_dir).toBe('/remembered');
    const existing = { client_request_id: 'existing', thread_id: 'old', prompt: 'continue' };
    expect(await prepareFlowerNewConversationInput(source, existing)).toBe(existing);
    expect(source.loadSettings).toHaveBeenCalledTimes(1);
    expect(source.getWorkingDirectoryPathContext).not.toHaveBeenCalled();
  });
  it('serializes field patches and never copies a thread or a previously selected model into reasoning', async () => {
    let current: FlowerConversationPreferences = { revision: 0, reasoning_by_model: {} };
    const patches: unknown[] = [];
    const client = createFlowerConversationPreferenceClient({
      load: async () => current,
      patch: async patch => {
        expect(patch.expected_revision).toBe(current.revision);
        patches.push(patch);
        current = { ...current, revision: current.revision + 1,
          ...(patch.model_id ? { model_id: patch.model_id } : {}),
          ...(patch.working_dir ? { working_dir: patch.working_dir } : {}),
          ...(patch.reasoning ? { reasoning_by_model: { ...current.reasoning_by_model, [patch.reasoning.model_id]: patch.reasoning.selection } } : {}),
        };
        return current;
      },
    });
    await Promise.all([
      client.save({ model_id: 'provider/a' }),
      client.save({ reasoning: { model_id: 'provider/b', selection: { level: 'default', budget_tokens: 4096 } } }),
      client.save({ working_dir: '/project-a' }),
    ]);
    expect(patches).toEqual([
      { model_id: 'provider/a', expected_revision: 0 },
      { reasoning: { model_id: 'provider/b', selection: { level: 'default', budget_tokens: 4096 } }, expected_revision: 1 },
      { working_dir: '/project-a', expected_revision: 2 },
    ]);
    expect(await client.load()).toEqual({ revision: 3, model_id: 'provider/a', working_dir: '/project-a', reasoning_by_model: { 'provider/b': { level: 'default', budget_tokens: 4096 } } });
  });

  it('does not retry conflicts or let a failed write poison later selections', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new Error('revision conflict')).mockResolvedValueOnce({ revision: 2, model_id: 'provider/b', reasoning_by_model: {} });
    const client = createFlowerConversationPreferenceClient({ load: async () => ({ revision: 1, reasoning_by_model: {} }), patch });
    await expect(client.save({ model_id: 'provider/a' })).rejects.toThrow('revision conflict');
    expect(patch).toHaveBeenCalledTimes(1);
    await expect(client.save({ model_id: 'provider/b' })).resolves.toMatchObject({ model_id: 'provider/b' });
    expect(patch).toHaveBeenCalledTimes(2);
  });
});

it('bounds preference reads including time spent behind a write', async () => {
  vi.useFakeTimers();
  const client = createFlowerConversationPreferenceClient({
    load: async () => ({ revision: 1, reasoning_by_model: {} }),
    patch: () => new Promise(() => {}),
  });
  const write = client.save({ model_id: 'provider/a' });
  const writeFailure = expect(write).rejects.toThrow('save timed out');
  await vi.advanceTimersByTimeAsync(0);
  const read = expect(client.load()).rejects.toThrow('read timed out');
  await vi.advanceTimersByTimeAsync(15_000);
  await read;
  await vi.advanceTimersByTimeAsync(105_000);
  await writeFailure;
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it('releases timed out writes without replay and reads a fresh CAS revision for the next choice', async () => {
  vi.useFakeTimers();
  const patch = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce({ revision: 3, model_id: 'provider/b', reasoning_by_model: {} });
  let revision = 1;
  const client = createFlowerConversationPreferenceClient({ load: async () => ({ revision, reasoning_by_model: {} }), patch });
  const timedOut = expect(client.save({ model_id: 'provider/a' })).rejects.toThrow('save timed out');
  await vi.advanceTimersByTimeAsync(120_000);
  await timedOut;
  revision = 2;
  await expect(client.save({ model_id: 'provider/b' })).resolves.toMatchObject({ revision: 3 });
  expect(patch.mock.calls).toEqual([[{ model_id: 'provider/a', expected_revision: 1 }], [{ model_id: 'provider/b', expected_revision: 2 }]]);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it.each(['dispose', 'revoke'])('never dispatches a queued preference write after %s', async reason => {
  const lifetime = new AbortController();
  let canMutate = true;
  let finish!: (value: { revision: number; reasoning_by_model: Record<string, never> }) => void;
  const load = vi.fn(() => new Promise<{ revision: number; reasoning_by_model: Record<string, never> }>(resolve => { finish = resolve; }));
  const patch = vi.fn();
  const client = createFlowerConversationPreferenceClient({ load, patch }, { signal: lifetime.signal, canMutate: () => canMutate });
  const first = client.save({ model_id: 'provider/a' });
  const second = client.save({ model_id: 'provider/b' });
  const failures = [expect(first).rejects.toMatchObject({ name: reason === 'dispose' ? 'AbortError' : 'NotAllowedError' }), expect(second).rejects.toMatchObject({ name: reason === 'dispose' ? 'AbortError' : 'NotAllowedError' })];
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  if (reason === 'dispose') lifetime.abort(); else canMutate = false;
  finish({ revision: 1, reasoning_by_model: {} });
  await Promise.all(failures);
  expect(patch).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
});

it('cancels an in-flight preference read when its lifetime ends even with a caller signal', async () => {
  const lifetime = new AbortController();
  const caller = new AbortController();
  let readSignal: AbortSignal | undefined;
  const client = createFlowerConversationPreferenceClient({
    load: async signal => { readSignal = signal; return new Promise(() => {}); }, patch: vi.fn(),
  }, { signal: lifetime.signal });
  const failed = expect(client.load(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(readSignal).toBeDefined());
  lifetime.abort();
  await failed;
  expect(readSignal!.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
});
