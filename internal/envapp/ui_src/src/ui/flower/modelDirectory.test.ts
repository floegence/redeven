import { describe, expect, it, vi } from 'vitest';
import { createFlowerModelReadResource, readFlowerModelDirectory } from '../../../../../flower_ui/src/modelDirectory';
import type { FlowerModelDirectory } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const configuration = { defaults: { permission_type: 'approval_required' as const }, model_profile: null, provider_secrets: [] };
const directory = (state: 'pending' | 'unavailable'): FlowerModelDirectory => ({
  current_model_id: 'static/agent',
  models: [
    { id: 'static/agent', label: 'Static agent', source: 'runtime_config', state: 'ready', provider_id: 'static', model_name: 'agent' },
    { id: 'offline/missing', label: 'Missing', source: 'runtime_config', state, provider_type: 'ollama', provider_id: 'offline', model_name: 'missing' },
  ],
  sources: [{ id: 'offline', kind: 'runtime_config', state }],
});

describe('connection-owned model reads', () => {
  it('makes the baseline usable before discovery and shares one background read', async () => {
    let finish!: (value: FlowerModelDirectory) => void;
    const full = new Promise<FlowerModelDirectory>(resolve => { finish = resolve; });
    const loadConfiguration = vi.fn(async () => configuration);
    const loadDirectory = vi.fn(async (baseline: boolean) => baseline ? directory('pending') : full);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration, loadDirectory });
    const changes = vi.fn();
    const unsubscribe = resource.subscribe(changes);
    const [first, second] = await Promise.all([resource.loadSettings(), resource.loadSettings()]);
    expect(first.model_directory?.models[0].state).toBe('ready');
    expect(second).toEqual(first);
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
    expect(loadDirectory).toHaveBeenCalledExactlyOnceWith(true);
    const refresh = resource.loadDirectory();
    const simultaneous = resource.loadDirectory(true);
    expect(refresh).toBe(simultaneous);
    finish(directory('unavailable'));
    await refresh;
    expect(loadDirectory.mock.calls).toEqual([[true], [false]]);
    expect((await resource.loadSettings()).model_directory?.models[0].state).toBe('ready');
    unsubscribe();
    const count = changes.mock.calls.length;
    await resource.loadDirectory(true);
    expect(changes).toHaveBeenCalledTimes(count);
  });

  it('rejects a late result after the owning session changes', async () => {
    let scope = 'first';
    let finish!: (value: FlowerModelDirectory) => void;
    const old = new Promise<FlowerModelDirectory>(resolve => { finish = resolve; });
    const resource = createFlowerModelReadResource({ scope: () => scope, loadConfiguration: async () => configuration,
      loadDirectory: async baseline => baseline ? directory('pending') : scope === 'first' ? old : directory('unavailable'),
    });
    await resource.loadSettings();
    const oldRead = resource.loadDirectory();
    await Promise.resolve();
    await Promise.resolve();
    scope = 'second';
    await resource.loadSettings();
    const changes = vi.fn();
    resource.subscribe(changes);
    finish({ ...directory('unavailable'), current_model_id: 'first/private' });
    await expect(oldRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(changes.mock.calls.some(([value]) => value.current_model_id === 'first/private')).toBe(false);
    expect((await resource.loadDirectory()).current_model_id).toBe('static/agent');
  });

  it('keeps a ready configured Ollama model usable while refreshing', async () => {
    let finish!: (value: FlowerModelDirectory) => void;
    const ready: FlowerModelDirectory = {
      ...directory('unavailable'),
      models: [{ ...directory('unavailable').models[0], provider_type: 'ollama' }],
    };
    const full = new Promise<FlowerModelDirectory>(resolve => { finish = resolve; });
    const resource = createFlowerModelReadResource({ scope: () => 'connection',
      loadConfiguration: async () => configuration,
      loadDirectory: async baseline => baseline ? ready : full,
    });
    await resource.loadSettings();
    const changes = vi.fn();
    resource.subscribe(changes);
    const refresh = resource.loadDirectory(true);
    await Promise.resolve();
    expect(changes.mock.calls.at(-1)?.[0].models[0].state).toBe('ready');
    finish(ready);
    await refresh;
  });

  it('finishes pending rows on failure and permits an explicit recovery', async () => {
    let recovered = false;
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: async () => configuration,
      loadDirectory: async baseline => { if (baseline) return directory('pending'); if (!recovered) throw new Error('private endpoint detail'); return directory('unavailable'); },
    });
    await resource.loadSettings();
    const failed = await resource.loadDirectory();
    expect(failed.models.map(model => model.state)).toEqual(['ready', 'unavailable']);
    expect(failed.sources[0].state).toBe('unavailable');
    expect(JSON.stringify(failed)).not.toContain('private endpoint');
    recovered = true;
    expect((await resource.loadDirectory(true)).error).toBeUndefined();
  });

  it('rejects unsupported response shapes and mismatched Desktop identities', () => {
    expect(() => readFlowerModelDirectory({ current_model: '', models: [] })).toThrow('invalid');
    expect(() => readFlowerModelDirectory({ current_model: '', directory: { models: [{ id: 'desktop:private', source: 'runtime_config', state: 'ready' }], sources: [] } })).toThrow('invalid');
  });
});
