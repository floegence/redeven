import { describe, expect, it, vi } from 'vitest';
import { createFlowerConversationPreferenceClient, prepareFlowerNewConversationInput } from './conversationPreferences';
import type { FlowerConversationPreferences, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';

describe('Flower explicit preference writes', () => {
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
