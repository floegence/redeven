import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerModelReadResource, readFlowerModelDirectory } from '../../../../../flower_ui/src/modelDirectory';
import type { FlowerModelDirectory, FlowerSettingsSnapshot } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const configuration: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' as const }, model_profile: null, provider_secrets: [] };
const directory: FlowerModelDirectory = {
  current_model_id: 'static/agent',
  models: [{ id: 'static/agent', label: 'Agent', source: 'runtime_config', state: 'ready', provider_id: 'static', model_name: 'agent' }],
  sources: [{ id: 'static', kind: 'runtime_config', state: 'ready' }],
};

describe('connection-owned local model reads', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces settings and directory without a supplier discovery read', async () => {
    const configRead = vi.fn(async () => configuration);
    const modelRead = vi.fn(async (_baseline: boolean, _signal: AbortSignal) => directory);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: modelRead });
    const [first, second] = await Promise.all([resource.loadSettings(), resource.loadSettings()]);
    expect(first).toEqual(second);
    expect(first.model_directory?.checking).toBe(false);
    expect(configRead).toHaveBeenCalledTimes(1);
    expect(modelRead).toHaveBeenCalledTimes(1);
    expect(modelRead.mock.calls[0]?.[0]).toBe(true);
  });
  it('reacquires an invalidated settings read and ignores the old late result', async () => {
    let finish!: (value: typeof configuration) => void;
    const configRead = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(configuration);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: async () => directory });
    const old = resource.loadSettings();
    await Promise.resolve(); await Promise.resolve();
    resource.invalidate();
    const current = resource.loadSettings();
    expect(await old).toEqual(await current);
    finish({ ...configuration, defaults: { permission_type: 'readonly' } } as typeof configuration);
    await Promise.resolve();
    expect((await resource.loadSettings()).defaults.permission_type).toBe('approval_required');
    expect(configRead).toHaveBeenCalledTimes(2);
  });
  it('never publishes an old account result into another connection', async () => {
    let scope = 'first'; let finish!: (value: FlowerModelDirectory) => void;
    const resource = createFlowerModelReadResource({ scope: () => scope, loadConfiguration: async () => configuration,
      loadDirectory: () => scope === 'first' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(directory) });
    const old = resource.loadSettings();
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve();
    scope = 'second'; await resource.loadSettings();
    finish({ ...directory, current_model_id: 'first/private' });
    await rejected;
    expect((await resource.loadDirectory()).current_model_id).toBe('static/agent');
  });
  it('rereads a directory change received during an older projection request without reloading settings', async () => {
    let finish!: (value: FlowerModelDirectory) => void;
    const latest = { ...directory, current_model_id: 'static/latest' };
    const configRead = vi.fn(async () => configuration);
    const modelRead = vi.fn().mockResolvedValueOnce(directory)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(latest);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: modelRead });
    await resource.loadSettings();
    const published = vi.fn(); resource.subscribe(published); published.mockClear();
    const refreshing = resource.loadDirectory(true);
    await Promise.resolve(); await Promise.resolve();
    const changed = resource.loadDirectory(true);
    finish(directory);
    expect(await refreshing).toEqual(await changed);
    expect((await resource.loadSettings()).model_directory?.current_model_id).toBe('static/latest');
    expect(published).toHaveBeenCalledTimes(1);
    expect(configRead).toHaveBeenCalledTimes(1);
  });
  it('retains usable metadata on a failed local projection refresh', async () => {
    let failed = false;
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: async () => configuration,
      loadDirectory: async () => { if (failed) throw new Error('offline'); return directory; } });
    await resource.loadSettings(); failed = true;
    const changes = vi.fn(); resource.subscribe(changes);
    expect(await resource.loadDirectory(true)).toMatchObject({ models: [{ state: 'ready' }], checking: false });
    expect(changes).toHaveBeenCalledTimes(1);
  });
  it('keeps successful configuration reads usable when the initial directory transport fails', async () => {
    const configRead = vi.fn(async () => configuration);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead,
      loadDirectory: async () => { throw new Error('offline'); } });
    expect(await resource.loadSettings()).toEqual(configuration);
    expect(await resource.loadSettings()).toEqual(configuration);
    expect(configRead).toHaveBeenCalledTimes(1);
    await expect(resource.loadDirectory(true)).rejects.toThrow('offline');
  });
  it('ends a hung initial settings read with a bounded error', async () => {
    vi.useFakeTimers();
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: () => new Promise(() => undefined), loadDirectory: async () => directory });
    const pending = expect(resource.loadSettings()).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(10_000); await pending;
  });
  it('rejects unsupported shapes and mismatched Desktop identities', () => {
    expect(() => readFlowerModelDirectory({ current_model: '', models: [] })).toThrow('invalid');
    expect(() => readFlowerModelDirectory({ current_model: '', directory: { models: [{ id: 'desktop:private', source: 'runtime_config', state: 'ready' }], sources: [] } })).toThrow('invalid');
  });
});
