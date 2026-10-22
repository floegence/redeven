import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerModelReadResource, readFlowerModelDirectory, withFlowerModelDirectory } from '../../../../../flower_ui/src/modelDirectory';
import { resolveFlowerProviderModels } from '../../../../../flower_ui/src/settings/modelSelection';
import { backendModelsForProviderType, providerDefaultsFixture } from '../../../../../flower_ui/testing/providerCatalogFixture';
import { cloneFlowerModel } from '../../../../../flower_ui/src/providerModelProjection';
import type { FlowerModelDirectory, FlowerSettingsSnapshot } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const configuration: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' as const }, model_profile: null, provider_secrets: [] };
const directory: FlowerModelDirectory = {
  current_model_id: 'static/agent',
  models: [{ id: 'static/agent', label: 'Agent', source: 'runtime_config', state: 'ready', provider_id: 'static', model_name: 'agent' }],
  sources: [{ id: 'static', kind: 'runtime_config', state: 'ready' }],
};

it('reads backend defaults without treating them as account inventory', () => {
  const defaults = { openai: [{ model_name: 'backend-only', context_window: 987654, max_output_tokens: 32109, supports_tools: true }] };
  const result = readFlowerModelDirectory({ current_model: '', directory: { models: [], sources: [], provider_catalogs: {}, provider_defaults: defaults } });
  expect(result.provider_defaults).toEqual(defaults);
  expect(result.models).toEqual([]);
  expect(() => readFlowerModelDirectory({ current_model: '', directory: { ...result, provider_defaults: { openai: [{ model_name: 'invalid', context_window: -1 }] } } })).toThrow('invalid');
});

it('carries search policy and complete defaults into settings without borrowing account availability', () => {
  const reviewed = cloneFlowerModel(backendModelsForProviderType('openai')[0]);
  const provider = { id: 'account', type: 'openai' as const, auth_method: 'chatgpt' as const, account_id: 'account', models: [], model_selection: { selected_models: [reviewed.model_name] } };
  const search = { status: 'available' as const, reason: '' };
  for (const available of [true, false]) {
    const projected = withFlowerModelDirectory({ ...configuration, model_profile: { schema_version: 1, providers: [provider], current_model_id: `account/${reviewed.model_name}` } }, {
      current_model_id: `account/${reviewed.model_name}`,
      models: [{ id: `account/${reviewed.model_name}`, model_name: reviewed.model_name, provider_id: 'account', label: 'Account model', source: 'runtime_config', state: available ? 'ready' : 'unavailable', web_search: search }],
      sources: [{ id: 'account', kind: 'runtime_config', state: available ? 'ready' : 'unavailable' }],
      provider_defaults: providerDefaultsFixture,
      provider_catalogs: { account: available ? [{ ...reviewed, web_search: search }] : [] },
    });
    const savedProvider = projected.model_profile!.providers[0];
    const reopened = resolveFlowerProviderModels(savedProvider, savedProvider.catalog_models);
    expect(reopened[0]).toEqual(expect.objectContaining({ ...reviewed, web_search: search }));
    expect(reopened[0].unavailable === true).toBe(!available);
  }
});

describe('connection-owned local model reads', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces settings and directory without a supplier discovery read', async () => {
    const configRead = vi.fn(async () => configuration);
    const modelRead = vi.fn(async (_baseline: boolean, _signal: AbortSignal) => directory);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: modelRead });
    const [first, second] = await Promise.all([resource.loadSettings(), resource.loadSettings()]);
    expect(first).toEqual(second);
    await resource.loadDirectory();
    expect((await resource.loadSettings()).model_directory?.checking).toBe(false);
    expect(configRead).toHaveBeenCalledTimes(1);
    expect(modelRead).toHaveBeenCalledTimes(1);
    expect(modelRead.mock.calls[0]?.[0]).toBe(true);
  });
  it('refreshes saved configuration explicitly after an uncertain save', async () => {
    const configRead = vi.fn().mockResolvedValueOnce(configuration).mockResolvedValue({ ...configuration, defaults: { permission_type: 'readonly' } });
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: async () => directory });
    await resource.loadSettings();
    expect((await resource.loadSettings()).defaults.permission_type).toBe('approval_required');
    expect((await resource.loadSettings(true)).defaults.permission_type).toBe('readonly');
    expect(configRead).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent forced settings refreshes', async () => {
    const reads: Array<(value: FlowerSettingsSnapshot) => void> = [];
    const configRead = vi.fn(() => new Promise<FlowerSettingsSnapshot>(resolve => { reads.push(resolve); }));
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: async () => directory });
    const first = resource.loadSettings(true);
    const second = resource.loadSettings(true);
    await Promise.resolve(); await Promise.resolve();

    expect(configRead).toHaveBeenCalledTimes(1);
    reads[0](configuration);
    await expect(Promise.all([first, second])).resolves.toEqual([configuration, configuration]);
  });
  it('lets a forced refresh supersede an ordinary settings read', async () => {
    const reads: Array<(value: FlowerSettingsSnapshot) => void> = [];
    const configRead = vi.fn(() => new Promise<FlowerSettingsSnapshot>(resolve => { reads.push(resolve); }));
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: async () => directory });
    const ordinary = resource.loadSettings();
    await Promise.resolve(); await Promise.resolve();
    const refreshed = resource.loadSettings(true);
    await Promise.resolve(); await Promise.resolve();

    expect(configRead).toHaveBeenCalledTimes(2);
    await expect(ordinary).rejects.toMatchObject({ name: 'AbortError' });
    reads[0](configuration);
    reads[1]({ ...configuration, defaults: { permission_type: 'readonly' } });
    await expect(refreshed).resolves.toMatchObject({ defaults: { permission_type: 'readonly' } });
    await expect(resource.loadSettings()).resolves.toMatchObject({ defaults: { permission_type: 'readonly' } });
  });
  it('releases an invalidated settings read without restarting its old owner', async () => {
    let finish!: (value: typeof configuration) => void;
    const configRead = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(configuration);
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: configRead, loadDirectory: async () => directory });
    const old = resource.loadSettings();
    await Promise.resolve(); await Promise.resolve();
    resource.invalidate();
    const current = resource.loadSettings();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await current;
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
  it('returns saved configuration without waiting for a hung local directory read', async () => {
    vi.useFakeTimers();
    const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: async () => configuration,
      loadDirectory: () => new Promise(() => undefined) });
    const settings = vi.fn();
    void resource.loadSettings().then(settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(settings).toHaveBeenCalledWith(configuration);
    resource.invalidate();
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

it('validates and retains backend search policy without frontend capability inference', () => {
  const policy = { editable: true, default_enabled: true, default_model_enabled: true, default_fetch_source: 'direct', enabled: false, source: 'native', supported_sources: ['native'] };
  const payload = { current_model: '', directory: { models: [], sources: [], search_policies: { openai: policy }, provider_search_policies: { proxy: policy } } };
  const result = readFlowerModelDirectory(payload);
  expect(result.search_policies?.openai).toEqual(policy);
  expect(result.provider_search_policies?.proxy).toEqual(policy);
  for (const patch of [{ enabled: 'true' }, { supported_sources: ['unknown'] }, { source: 'auto' }, { default_fetch_source: 'auto' }, { default_fetch_source: undefined }, { editable: undefined }]) {
    expect(() => readFlowerModelDirectory({ ...payload, directory: { ...payload.directory, search_policies: { openai: { ...policy, ...patch } } } })).toThrow('invalid');
  }
});
