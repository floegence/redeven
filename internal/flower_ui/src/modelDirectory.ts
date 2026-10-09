import type { FlowerModelDirectory, FlowerModelSourceStatus, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';

export type FlowerModelReadResource = Readonly<{
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (refresh?: boolean) => Promise<FlowerModelDirectory>;
  subscribe: (listener: (directory: FlowerModelDirectory) => void) => () => void;
  invalidate: () => void;
}>;

export function readFlowerModelDirectory(value: unknown): FlowerModelDirectory {
  const response = value as { current_model?: unknown; directory?: FlowerModelDirectory } | null;
  const directory = response?.directory;
  const states = ['ready', 'pending', 'unavailable'];
  const kinds = ['runtime_config', 'desktop_model_source', 'platform'];
  if (!directory || !Array.isArray(directory.models) || !Array.isArray(directory.sources)
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
  return { current_model_id: response.current_model, models: directory.models, sources: directory.sources };
}

const emptyDirectory = (): FlowerModelDirectory => ({ current_model_id: '', models: [], sources: [] });
const failedDirectory = (previous: FlowerModelDirectory): FlowerModelDirectory => ({
  ...previous, error: 'directory_unavailable',
  models: previous.models.map(model => model.state === 'pending' ? { ...model, state: 'unavailable', reason: 'catalog_unavailable' } : model),
  sources: previous.sources.map(source => source.state === 'pending' ? { ...source, state: 'unavailable', reason: 'catalog_unavailable' } : source),
});

// This resource coalesces product reads within one owning connection. It never
// discovers models, authorizes execution, opens a transport, or retains secrets.
export function createFlowerModelReadResource(options: Readonly<{
  scope: () => string;
  loadConfiguration: () => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (baseline: boolean) => Promise<FlowerModelDirectory>;
}>): FlowerModelReadResource {
  let scope = options.scope();
  let generation = 0;
  let configuration: FlowerSettingsSnapshot | null = null;
  let settingsRequest: Promise<FlowerSettingsSnapshot> | null = null;
  let baselineRequest: Promise<FlowerModelDirectory> | null = null;
  let fullRequest: Promise<FlowerModelDirectory> | null = null;
  let directory: FlowerModelDirectory | null = null;
  let complete = false;
  const listeners = new Set<(directory: FlowerModelDirectory) => void>();
  const invalidate = () => {
    generation += 1;
    configuration = null; directory = null; complete = false;
    settingsRequest = null; baselineRequest = null; fullRequest = null;
  };
  const checkScope = () => {
    const next = options.scope();
    if (next !== scope) { scope = next; invalidate(); }
  };
  const publish = (value: FlowerModelDirectory) => {
    directory = value;
    for (const listener of listeners) listener(value);
    return value;
  };
  const assertCurrent = (revision: number) => {
    checkScope();
    if (revision !== generation) throw new DOMException('Flower model read cancelled.', 'AbortError');
  };
  const baseline = () => {
    checkScope();
    if (directory) return Promise.resolve(directory);
    if (baselineRequest) return baselineRequest;
    const revision = generation;
    const request = options.loadDirectory(true).then(value => {
      assertCurrent(revision);
      return complete ? directory! : publish(value);
    }).catch(error => {
      assertCurrent(revision);
      if ((error as Error)?.name === 'AbortError') throw error;
      return publish(failedDirectory(emptyDirectory()));
    }).finally(() => { if (baselineRequest === request) baselineRequest = null; });
    baselineRequest = request;
    return request;
  };
  return {
    invalidate,
    subscribe: listener => { listeners.add(listener); checkScope(); if (directory) listener(directory); return () => { listeners.delete(listener); }; },
    loadSettings: () => {
      checkScope();
      if (configuration && directory) return Promise.resolve({ ...configuration, model_directory: directory });
      if (settingsRequest) return settingsRequest;
      const revision = generation;
      const request = Promise.all([options.loadConfiguration(), baseline()]).then(([value, models]) => {
        assertCurrent(revision);
        configuration = value;
        return { ...value, model_directory: directory ?? models };
      }).finally(() => { if (settingsRequest === request) settingsRequest = null; });
      settingsRequest = request;
      return request;
    },
    loadDirectory: (refresh = false) => {
      checkScope();
      if (fullRequest) return fullRequest;
      if (!refresh && complete && directory) return Promise.resolve(directory);
      const revision = generation;
      const request = baseline().then(async () => {
        assertCurrent(revision);
        const previous = directory ?? emptyDirectory();
        publish({ ...previous, error: undefined });
        try {
          const value = await options.loadDirectory(false);
          assertCurrent(revision);
          if (value.models.some(model => model.state === 'pending') || value.sources.some(source => source.state === 'pending')) throw new Error('Flower model directory did not finish checking.');
          complete = true;
          return publish(value);
        } catch (error) {
          assertCurrent(revision);
          if ((error as Error)?.name === 'AbortError') throw error;
          complete = true;
          return publish(failedDirectory(directory ?? previous));
        }
      }).finally(() => { if (fullRequest === request) fullRequest = null; });
      fullRequest = request;
      return request;
    },
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
  return { ...snapshot, model_directory: directory,
    model_source: flowerDirectoryDesktopStatus(directory),
    platform_model_source: directory.sources.some(source => source.kind === 'platform') ? {
      models: directory.models.filter(model => model.source === 'platform' && model.state === 'ready'),
      current_model_id: directory.current_model_id.startsWith('platform/') ? directory.current_model_id : undefined,
      error: directory.sources.some(source => source.kind === 'platform' && source.state === 'unavailable') ? 'Redeven AI is currently unavailable. Select another model or try again.' : undefined,
    } : undefined,
  };
}
