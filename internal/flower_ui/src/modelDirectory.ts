import { projectFlowerProviderModels } from './providerModelProjection';
import type { FlowerModelDirectory, FlowerModelSourceStatus, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';

export type FlowerModelReadResource = Readonly<{
  loadSettings: (refresh?: boolean) => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (refresh?: boolean, prepare?: () => Promise<unknown>) => Promise<FlowerModelDirectory>;
  subscribe: (listener: (directory: FlowerModelDirectory) => void) => () => void;
  invalidate: () => void;
}>;

export function readFlowerModelDirectory(value: unknown): FlowerModelDirectory {
  const response = value as { current_model?: unknown; directory?: FlowerModelDirectory } | null;
  const directory = response?.directory;
  const states = ['ready', 'pending', 'unavailable'];
  const kinds = ['runtime_config', 'desktop_model_source', 'platform'];
  const invalidCatalogs = [directory?.provider_defaults, directory?.provider_catalogs].some(catalogs => catalogs !== undefined && (!catalogs || typeof catalogs !== 'object' || Array.isArray(catalogs)
    || Object.entries(catalogs).some(([providerID, models]) => !providerID.trim() || !Array.isArray(models)
      || new Set(models.map(model => model?.model_name)).size !== models.length
      || models.some(model => !model || typeof model.model_name !== 'string' || !model.model_name.trim() || model.model_name.includes(String.fromCharCode(0)) || /[\r\n/]/u.test(model.model_name)
        || (model.wire_model_name !== undefined && (typeof model.wire_model_name !== 'string' || model.wire_model_name.includes(String.fromCharCode(0)) || /[\r\n]/u.test(model.wire_model_name)))
        || (model.supports_tools !== undefined && typeof model.supports_tools !== 'boolean')
        || (model.web_search_enabled !== undefined && typeof model.web_search_enabled !== 'boolean')
        || [model.context_window, model.max_output_tokens].some(limit => limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))))));
  const invalidSearchPolicies = [directory?.search_policies, directory?.provider_search_policies].some(policies => policies !== undefined && (!policies || typeof policies !== 'object' || Array.isArray(policies)
    || Object.entries(policies).some(([key, policy]) => !key.trim() || !policy
      || [policy.editable, policy.default_enabled, policy.default_model_enabled, policy.enabled].some(flag => typeof flag !== 'boolean')
      || !['direct', 'deepseek'].includes(policy.default_fetch_source)
      || !['native', 'brave'].includes(policy.source) || !Array.isArray(policy.supported_sources)
      || new Set(policy.supported_sources).size !== policy.supported_sources.length
      || policy.supported_sources.some(source => !['native', 'brave'].includes(source)))));
  if (!directory || !Array.isArray(directory.models) || !Array.isArray(directory.sources)
    || invalidCatalogs || invalidSearchPolicies
    || typeof response?.current_model !== 'string'
    || new Set(directory.models.map(model => model?.id)).size !== directory.models.length
    || new Set(directory.sources.map(source => source?.id)).size !== directory.sources.length
    || directory.sources.some(source => !source || !source.id || !kinds.includes(source.kind) || !states.includes(source.state))
    || directory.models.some(model => !model || typeof model.id !== 'string' || !model.id.trim()
      || !states.includes(model.state) || (model.source !== undefined && !kinds.includes(model.source))
      || (model.state === 'ready' && !model.source)
      || (model.source === 'desktop_model_source' && !/^desktop:model_[0-9a-f]{64}$/u.test(model.id))
      || (model.source !== 'desktop_model_source' && model.id.startsWith('desktop:'))
      || (model.source === 'platform' && !model.id.startsWith('platform/'))
      || (model.source !== 'platform' && model.id.startsWith('platform/'))
      || (model.source === 'runtime_config' && model.id !== `${model.provider_id}/${model.model_name}`))) {
    throw new Error('Flower model directory response is invalid.');
  }
  return { current_model_id: response.current_model, models: directory.models, sources: directory.sources, provider_catalogs: directory.provider_catalogs, provider_defaults: directory.provider_defaults, search_policies: directory.search_policies, provider_search_policies: directory.provider_search_policies };
}

const MODEL_READ_DEADLINE_MS = 10_000;

function readWithSignal<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => { signal.throwIfAborted(); return read(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// A connection owns one settings read and one local directory read. Supplier
// synchronization never enters this resource or invalidates configuration.
export function createFlowerModelReadResource(options: Readonly<{
  scope: () => string;
  loadConfiguration: (signal: AbortSignal) => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (baseline: boolean, signal: AbortSignal) => Promise<FlowerModelDirectory>;
}>): FlowerModelReadResource {
  let scope = options.scope();
  let generation = 0;
  let configuration: FlowerSettingsSnapshot | null = null;
  let settingsRequest: Promise<FlowerSettingsSnapshot> | null = null;
  let settingsRequestRefresh = false;
  let directoryRequest: Promise<FlowerModelDirectory> | null = null;
  let directoryRead: { again: boolean } | null = null;
  let directory: FlowerModelDirectory | null = null;
  const listeners = new Set<(directory: FlowerModelDirectory) => void>();
  const controllers = new Set<AbortController>();
  const invalidate = () => {
    generation += 1;
    for (const controller of controllers) controller.abort(new DOMException('Flower model read cancelled.', 'AbortError'));
    controllers.clear();
    configuration = null; directory = null;
    settingsRequest = null; directoryRequest = null; directoryRead = null;
    settingsRequestRefresh = false;
  };
  const checkScope = () => {
    const next = options.scope();
    if (next !== scope) { scope = next; invalidate(); }
  };
  const read = async <T,>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new DOMException('Flower model read timed out.', 'TimeoutError')), MODEL_READ_DEADLINE_MS);
    try { return await readWithSignal(controller.signal, () => operation(controller.signal)); }
    finally { clearTimeout(timer); controllers.delete(controller); }
  };
  const loadDirectory = (refresh = false, prepare?: () => Promise<unknown>): Promise<FlowerModelDirectory> => {
    checkScope();
    if (directoryRequest) {
      if (refresh && directoryRead) directoryRead.again = true;
      return directoryRequest;
    }
    if (directory && !refresh) return Promise.resolve(directory);
    const revision = generation;
    const requestScope = scope;
    const readState = { again: false };
    directoryRead = readState;
    const request = (async () => {
      if (refresh && prepare) await read(signal => readWithSignal(signal, prepare));
      while (true) {
        readState.again = false;
        const value = await read(signal => options.loadDirectory(true, signal));
        checkScope();
        if (revision !== generation || !readState.again) return value;
      }
    })().then(value => {
      checkScope();
      if (revision !== generation) {
        if (requestScope !== scope) throw new DOMException('Flower connection changed.', 'AbortError');
        return loadDirectory();
      }
      directory = { ...value, checking: false };
      for (const listener of listeners) listener(directory);
      return directory;
    }).catch(error => {
      checkScope();
      if (revision !== generation && requestScope === scope) return loadDirectory();
      // A transport failure is not evidence that a known model disappeared.
      if (revision === generation && directory) return directory;
      throw error;
    }).finally(() => { if (directoryRequest === request) { directoryRequest = null; directoryRead = null; } });
    directoryRequest = request;
    return request;
  };
  const loadSettings = (refresh = false): Promise<FlowerSettingsSnapshot> => {
    checkScope();
    if (refresh && settingsRequest && settingsRequestRefresh) return settingsRequest;
    if (refresh) invalidate();
    if (configuration) return Promise.resolve(directory ? withFlowerModelDirectory(configuration, directory) : configuration);
    if (settingsRequest) return settingsRequest;
    const revision = generation;
    // Read local availability independently; provider discovery never enters
    // this path and a slow directory cannot delay saved configuration.
    const request = read(options.loadConfiguration).then(value => {
      checkScope();
      if (revision !== generation) {
        throw new DOMException('Flower settings read was superseded.', 'AbortError');
      }
      configuration = value;
      if (!directory && value.model_directory) {
        directory = value.model_directory;
        for (const listener of listeners) listener(directory);
      }
      return directory ? withFlowerModelDirectory(value, directory) : value;
    }).finally(() => {
      if (settingsRequest === request) {
        settingsRequest = null;
        settingsRequestRefresh = false;
      }
    });
    void loadDirectory().catch(() => undefined);
    settingsRequest = request;
    settingsRequestRefresh = refresh;
    return request;
  };
  return { invalidate, loadSettings, loadDirectory,
    subscribe: listener => { listeners.add(listener); checkScope(); if (directory) listener(directory); return () => { listeners.delete(listener); }; },
  };
}

export function flowerDirectoryDesktopStatus(directory: FlowerModelDirectory): FlowerModelSourceStatus | undefined {
  const source = directory.sources.find(source => source.kind === 'desktop_model_source');
  if (!source) return undefined;
  const base = { kind: 'desktop_model_source', label: 'Desktop' } as const;
  const models = directory.models.filter(model => model.source === 'desktop_model_source' && model.state === 'ready');
  if (source.state === 'ready' && models.length) return { ...base, state: 'ready', models: models as [typeof models[number], ...typeof models], current_model_id: directory.current_model_id.startsWith('desktop:') ? directory.current_model_id : undefined };
  if (source.state === 'pending') return { ...base, state: 'connecting' };
  if (source.reason === 'missing_keys') return { ...base, state: 'missing_keys', missing_key_provider_ids: source.missing_key_provider_ids ?? [] };
  if (source.reason === 'not_configured' || source.reason === 'empty' || source.reason === 'unbound' || source.reason === 'expired' || source.reason === 'unsupported' || source.reason === 'connecting') return { ...base, state: source.reason };
  return { ...base, state: 'error' };
}

export function withFlowerModelDirectory(snapshot: FlowerSettingsSnapshot, directory: FlowerModelDirectory): FlowerSettingsSnapshot {
  const runtimeModels = new Map(directory.models.filter(model => model.source === 'runtime_config').map(model => [model.id, model]));
  return { ...snapshot, model_directory: directory,
    model_profile: snapshot.model_profile ? { ...snapshot.model_profile, providers: snapshot.model_profile.providers.map(provider => {
      provider = { ...provider, model_defaults: directory.provider_defaults?.[provider.type], search_policy: directory.provider_search_policies?.[provider.id] ?? directory.search_policies?.[provider.type] };
      const catalog = directory.provider_catalogs?.[provider.id];
      const resolved = catalog ? { ...provider, catalog_models: catalog, models: projectFlowerProviderModels(provider, catalog) } : provider;
      return { ...resolved, models: resolved.models.map(model => ({ ...model, web_search: runtimeModels.get(`${provider.id}/${model.model_name}`)?.web_search ?? model.web_search })) };
    }) } : null,
    model_source: flowerDirectoryDesktopStatus(directory),
    platform_model_source: directory.sources.some(source => source.kind === 'platform') ? {
      models: directory.models.filter(model => model.source === 'platform' && model.state === 'ready'),
      current_model_id: directory.current_model_id.startsWith('platform/') ? directory.current_model_id : undefined,
    } : undefined,
  };
}
