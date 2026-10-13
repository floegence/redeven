import type { FlowerModelDirectory, FlowerModelSourceStatus, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';

export type FlowerModelReadResource = Readonly<{
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (refresh?: boolean, prepare?: () => Promise<unknown>) => Promise<FlowerModelDirectory>;
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
const failedDirectory = (previous: FlowerModelDirectory, timedOut = false): FlowerModelDirectory => ({
  ...previous, checking: false, error: timedOut ? 'directory_timeout' : 'directory_unavailable',
  models: previous.models.map(model => model.state === 'pending' ? { ...model, state: 'unavailable', reason: 'catalog_unavailable' } : model),
  sources: previous.sources.map(source => source.state === 'pending' ? { ...source, state: 'unavailable', reason: 'catalog_unavailable' } : source),
});

const MODEL_READ_DEADLINE_MS = 10_000;

// Desktop IPC may not support cancellation. Settle the owning read on abort and
// consume its late result without allowing it to publish into the directory.
function readWithSignal<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => { signal.throwIfAborted(); return read(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// This resource coalesces product reads within one owning connection. It never
// discovers models, authorizes execution, opens a transport, or retains secrets.
export function createFlowerModelReadResource(options: Readonly<{
  scope: () => string;
  loadConfiguration: (signal: AbortSignal) => Promise<FlowerSettingsSnapshot>;
  loadDirectory: (baseline: boolean, signal: AbortSignal) => Promise<FlowerModelDirectory>;
}>): FlowerModelReadResource {
  let scope = options.scope();
  let generation = 0;
  let configuration: FlowerSettingsSnapshot | null = null;
  let settingsRequest: Promise<FlowerSettingsSnapshot> | null = null;
  let activeCheck: Readonly<{ baseline: Promise<FlowerModelDirectory>; full: Promise<FlowerModelDirectory> }> | null = null;
  let directory: FlowerModelDirectory | null = null;
  let complete = false;
  const listeners = new Set<(directory: FlowerModelDirectory) => void>();
  const controllers = new Set<AbortController>();
  const deadline = () => {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new DOMException('Flower model read timed out.', 'TimeoutError')), MODEL_READ_DEADLINE_MS);
    return { signal: controller.signal, dispose: () => { clearTimeout(timer); controllers.delete(controller); } };
  };
  const invalidate = () => {
    generation += 1;
    for (const controller of controllers) controller.abort(new DOMException('Flower model read cancelled.', 'AbortError'));
    controllers.clear();
    configuration = null; directory = null; complete = false;
    settingsRequest = null; activeCheck = null;
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
  const startCheck = (refresh = false, prepare?: () => Promise<unknown>) => {
    checkScope();
    if (activeCheck) return activeCheck;
    if (!refresh && complete && directory) return { baseline: Promise.resolve(directory), full: Promise.resolve(directory) };
    const revision = generation;
    const check = deadline();
    const baseline = directory ? Promise.resolve(directory) : readWithSignal(check.signal, () => options.loadDirectory(true, check.signal)).then(value => {
      assertCurrent(revision);
      return publish({ ...value, checking: true });
    }).catch(error => {
      assertCurrent(revision);
      return publish(failedDirectory(emptyDirectory(), (error as Error)?.name === 'TimeoutError'));
    });
    const full = baseline.then(async () => {
      assertCurrent(revision);
      const previous = directory ?? emptyDirectory();
      try {
        if (!refresh && !previous.error && !previous.models.some(model => model.state === 'pending') && !previous.sources.some(source => source.state === 'pending')) {
          complete = true;
          return publish({ ...previous, checking: false });
        }
        publish({ ...previous, checking: true, error: refresh ? undefined : previous.error });
        if (refresh && prepare) await readWithSignal(check.signal, prepare);
        const value = await readWithSignal(check.signal, () => options.loadDirectory(false, check.signal));
        assertCurrent(revision);
        if (value.models.some(model => model.state === 'pending') || value.sources.some(source => source.state === 'pending')) throw new Error('Flower model directory did not finish checking.');
        complete = true;
        return publish({ ...value, checking: false });
      } catch (error) {
        assertCurrent(revision);
        complete = true;
        return publish(failedDirectory(directory ?? previous, (error as Error)?.name === 'TimeoutError'));
      }
    }).finally(() => { check.dispose(); if (activeCheck?.full === full) activeCheck = null; });
    // Settings consume the baseline while discovery continues independently.
    // Scope cancellation can reject a background check without a full reader.
    void full.catch(() => undefined);
    activeCheck = { baseline, full };
    return activeCheck;
  };
  return {
    invalidate,
    subscribe: listener => { listeners.add(listener); checkScope(); if (directory) listener(directory); return () => { listeners.delete(listener); }; },
    loadSettings: () => {
      checkScope();
      if (configuration && directory) return Promise.resolve({ ...configuration, model_directory: directory });
      if (settingsRequest) return settingsRequest;
      const revision = generation;
      const settingsDeadline = deadline();
      const configurationRead = readWithSignal(settingsDeadline.signal, () => options.loadConfiguration(settingsDeadline.signal));
      const check = startCheck();
      const request = Promise.all([configurationRead, check.baseline]).then(([value, models]) => {
        assertCurrent(revision);
        configuration = value;
        return { ...value, model_directory: directory ?? models };
      }).finally(() => { settingsDeadline.dispose(); if (settingsRequest === request) settingsRequest = null; });
      settingsRequest = request;
      return request;
    },
    loadDirectory: (refresh = false, prepare) => startCheck(refresh, prepare).full,
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
