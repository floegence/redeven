import {
  PluginBridgeClient,
  type PluginOperation,
  type PluginOperationProgress,
  type PluginStream,
  type PluginSurfaceContext,
  type PluginUIActionEvent,
  type PluginUIElementVNode,
  type PluginUIVNode,
} from '@floegence/redevplugin-ui/plugin';
import {
  RedevenContainerResourcesV3Client,
  isRedevenContainerResourcesV3BusinessError,
  type ContainersListResponse,
  type ContainersInspectResponse,
  type CreateRequest,
  type ImagesResponse,
  type ImageResponse,
  type HistoryResponse,
  type VolumesResponse,
  type VolumeResponse,
  type StatsEvent,
} from '../../../../spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v3/v3.0.0/redeven.container_resources.v3.client';
import {
  containersCopy,
  localizedSearchTerms,
  resolveContainersLocale,
  type CopyKey,
  type CopyParams,
} from './i18n';
import { cancellationFailurePolicy, mutationOutcome, submissionFailurePolicy } from './operation-policy';

type Engine = 'docker' | 'podman';
type View = 'containers' | 'images' | 'volumes';
type ResourceFilter = 'all' | 'running' | 'paused' | 'stopped' | 'in-use' | 'unused';
type SortKey = 'name' | 'created' | 'state' | 'size' | 'usage';
type Container = ContainersListResponse['containers'][number];
type Image = ImagesResponse['images'][number];
type Volume = VolumesResponse['volumes'][number];
type AnyOperation = PluginOperation<object>;
type AnyStream = PluginStream<object, object>;
type Message = { key: CopyKey; params?: Record<string, string | number | Message> } | { literal: string };
type Plan = {
  method: string;
  plan_digest?: string;
  risk_level?: string;
  risk_flags?: Array<{ id: string; severity: string; title?: string; detail?: string }>;
  summary?: string[];
  requires_admin?: boolean;
  target?: object;
  request?: object;
};
type Intent =
  | { kind: 'create-container'; request: CreateRequest }
  | { kind: 'start-container'; containerID: string }
  | { kind: 'remove-container'; containerID: string; force: boolean; confirmationName: string }
  | { kind: 'prune-images' }
  | { kind: 'create-volume'; name: string; driver: string; options?: Array<{ key: string; value: string }> }
  | { kind: 'remove-volume'; name: string }
  | { kind: 'prune-volumes' }
  | { kind: 'remove-image'; image: string; force: boolean; confirmationName: string }
  | { kind: 'direct'; method: DirectMethod; target: string };
type DirectMethod = 'stop' | 'restart' | 'pause' | 'unpause' | 'kill';
type InspectorTab = 'overview' | 'usage' | 'logs';
type FormRowKind = 'command' | 'env' | 'ports' | 'mounts' | 'devices' | 'volume-options';
type Dialog =
  | { kind: 'none' }
  | { kind: 'create-container'; error?: Message }
  | { kind: 'pull-image'; error?: Message }
  | { kind: 'tag-image'; image: string; error?: Message }
  | { kind: 'create-volume'; error?: Message }
  | { kind: 'remove-container'; containerID: string; containerName: string; running: boolean; error?: Message }
  | { kind: 'remove-image'; image: string; references: number; error?: Message }
  | { kind: 'plan'; title: Message; plan: Plan; summary?: Message[]; intent: Intent; busy: boolean; error?: Message }
  | { kind: 'details'; title: Message; body: () => PluginUIVNode; returnKey: string; containerID?: string; tab?: InspectorTab };
type OperationRecord = {
  key: string;
  label: Message;
  target: Message;
  operationID: string;
  status: Message;
  progress?: PluginOperationProgress;
  error?: Message;
  handle?: AnyOperation;
  reconcile?: (terminalStatus?: string) => Promise<ReconcileResult>;
  observation?: AbortController;
};
type ReconcileResult = { complete: boolean; detail?: Message };

const bridge = new PluginBridgeClient({ timeoutMs: 30_000 });
const client = new RedevenContainerResourcesV3Client(bridge);
const state = {
  engine: 'docker' as Engine,
  view: 'containers' as View,
  query: '',
  filters: { containers: 'all', images: 'all', volumes: 'all' } as Record<View, ResourceFilter>,
  sorts: { containers: 'state', images: 'name', volumes: 'name' } as Record<View, SortKey>,
  available: false,
  version: '',
  loading: true,
  updating: false,
  loaded: false,
  dataEngine: 'docker' as Engine,
  error: undefined as Message | undefined,
  viewErrors: {} as Partial<Record<View, Message>>,
  partialFailures: { images: 0, volumes: 0 } as Record<'images' | 'volumes', number>,
  inventoryFresh: { containers: false, images: false, volumes: false } as Record<View, boolean>,
  statsFailures: 0,
  notice: undefined as Message | undefined,
  containers: [] as Container[],
  images: [] as Image[],
  volumes: [] as Volume[],
  containerStats: new Map<string, StatsEvent>(),
  liveLogs: new Map<string, string[]>(),
  formRows: initialFormRows(),
  nextFormRowID: 2,
  dialog: { kind: 'none' } as Dialog,
  operations: new Map<string, OperationRecord>(),
  context: undefined as PluginSurfaceContext | undefined,
};
let disposed = false;
let refreshGeneration = 0;
let activeDetailStream: AnyStream | undefined;

bridge.onContext((context) => {
  state.context = context;
  void renderSafely();
});
bridge.onLifecycle((event) => {
  if (event.type === 'dispose') {
    disposed = true;
    refreshGeneration += 1;
    for (const operation of state.operations.values()) operation.observation?.abort();
    void activeDetailStream?.cancel('surface disposed');
    activeDetailStream = undefined;
  }
});

for (const [action, handler] of Object.entries({
  'select-view': selectView,
  'select-engine': selectEngine,
  'filter-resources': filterResources,
  'select-filter': selectFilter,
  'select-sort': selectSort,
  'reset-refinements': resetRefinements,
  'add-form-row': addFormRow,
  'remove-form-row': removeFormRow,
  'refresh-resources': async () => refresh(),
  'open-create-container': async () => openDialog({ kind: 'create-container' }),
  'open-pull-image': async () => openDialog({ kind: 'pull-image' }),
  'open-create-volume': async () => openDialog({ kind: 'create-volume' }),
  'close-dialog': async () => closeDialog(),
  'submit-create-container': submitCreateContainer,
  'submit-pull-image': submitPullImage,
  'submit-tag-image': submitTagImage,
  'submit-create-volume': submitCreateVolume,
  'submit-remove-container': submitRemoveContainer,
  'submit-remove-image': submitRemoveImage,
  'confirm-plan': confirmPlan,
  'cancel-operation': cancelOperation,
  'resume-operation': resumeOperation,
  'container-action': containerAction,
  'container-details': containerDetails,
  'container-stats': containerStats,
  'container-logs': containerLogs,
  'select-inspector-tab': selectInspectorTab,
  'image-details': imageDetails,
  'image-history': imageHistory,
  'image-tag': openImageTag,
  'image-remove': removeImage,
  'prune-images': pruneImages,
  'volume-details': volumeDetails,
  'volume-remove': removeVolume,
  'prune-volumes': pruneVolumes,
} as const)) bridge.onAction(action, (event) => void handler(event));

void initialize();

async function initialize(): Promise<void> {
  await bridge.ready();
  state.context = bridge.context();
  await refresh();
}

async function selectView(event: PluginUIActionEvent): Promise<void> {
  if (event.value !== 'containers' && event.value !== 'images' && event.value !== 'volumes') return;
  state.view = event.value;
  state.query = '';
  state.error = undefined;
  await renderSafely();
}

async function selectEngine(event: PluginUIActionEvent): Promise<void> {
  if (event.value !== 'docker' && event.value !== 'podman') return;
  state.engine = event.value;
  state.error = undefined;
  state.dialog = { kind: 'none' };
  state.loaded = false;
  state.dataEngine = event.value;
  state.containers = [];
  state.images = [];
  state.volumes = [];
  state.containerStats.clear();
  await refresh();
}

async function filterResources(event: PluginUIActionEvent): Promise<void> {
  if (event.isComposing) return;
  state.query = event.value?.slice(0, 200) ?? '';
  await renderSafely();
}

async function selectFilter(event: PluginUIActionEvent): Promise<void> {
  const value = event.value as ResourceFilter | undefined;
  if (!value || !filterOptions(state.view).some((item) => item.value === value)) return;
  state.filters[state.view] = value;
  await renderSafely();
}

async function selectSort(event: PluginUIActionEvent): Promise<void> {
  const value = event.value as SortKey | undefined;
  if (!value || !sortOptions(state.view).some((item) => item.value === value)) return;
  state.sorts[state.view] = value;
  await renderSafely();
}

async function resetRefinements(): Promise<void> {
  state.query = '';
  state.filters[state.view] = 'all';
  await renderSafely();
}

async function addFormRow(event: PluginUIActionEvent): Promise<void> {
  const kind = event.value as FormRowKind | undefined;
  if (!kind || !(kind in state.formRows) || state.formRows[kind].length >= 24) return;
  state.formRows[kind].push(state.nextFormRowID++);
  await renderSafely();
}

async function removeFormRow(event: PluginUIActionEvent): Promise<void> {
  const [kindValue, idValue] = splitValue(event.value);
  const kind = kindValue as FormRowKind;
  const id = Number(idValue);
  if (!(kind in state.formRows) || !Number.isInteger(id) || state.formRows[kind].length <= 1) return;
  state.formRows[kind] = state.formRows[kind].filter((item) => item !== id);
  await renderSafely();
}

async function refresh(): Promise<boolean> {
  const generation = ++refreshGeneration;
  const fresh: Record<View, boolean> = { containers: false, images: false, volumes: false };
  state.inventoryFresh = fresh;
  const engine = state.engine;
  const hadInventory = state.loaded && state.dataEngine === engine;
  state.loading = !hadInventory;
  state.updating = hadInventory;
  state.error = undefined;
  state.viewErrors = {};
  await renderSafely();
  try {
    const status = await client.status({ engine });
    if (generation !== refreshGeneration) return false;
    state.available = status.available;
    state.version = status.engine_version ?? '';
    if (!status.available) { state.inventoryFresh = fresh; return false; }
    const [containersResult, imagesResult, volumesResult] = await Promise.allSettled([
      client.list({ engine, all: true }), client.listImages({ engine }), client.listVolumes({ engine }),
    ]);
    if (generation !== refreshGeneration) return false;
    if (containersResult.status === 'fulfilled') {
      fresh.containers = true;
      state.containers = [...containersResult.value.containers];
      const snapshots = await allSettledWithLimit(state.containers.filter((item) => item.state === 'running'), 4, async (item) => {
        const result = await client.statsSnapshot({ engine, container_id: item.container_id });
        return [item.container_id, result.stats] as const;
      });
      if (generation !== refreshGeneration) return false;
      state.containerStats.clear();
      state.statsFailures = snapshots.filter((snapshot) => snapshot.status === 'rejected').length;
      for (const snapshot of snapshots) if (snapshot.status === 'fulfilled') state.containerStats.set(snapshot.value[0], snapshot.value[1]);
    } else {
      state.viewErrors.containers = readableError(containersResult.reason, msg('loadFailed', { resource: viewMessage('containers') }));
    }
    if (imagesResult.status === 'fulfilled') {
      fresh.images = true;
      state.images = [...imagesResult.value.images];
      state.partialFailures.images = imagesResult.value.partial_failure_count;
    } else {
      state.viewErrors.images = readableError(imagesResult.reason, msg('loadFailed', { resource: viewMessage('images') }));
    }
    if (volumesResult.status === 'fulfilled') {
      fresh.volumes = true;
      state.volumes = [...volumesResult.value.volumes];
      state.partialFailures.volumes = volumesResult.value.partial_failure_count;
    } else {
      state.viewErrors.volumes = readableError(volumesResult.reason, msg('loadFailed', { resource: viewMessage('volumes') }));
    }
    state.loaded = true;
    state.dataEngine = engine;
    state.inventoryFresh = fresh;
    const currentSucceeded = state.view === 'containers' ? containersResult.status === 'fulfilled' : state.view === 'images' ? imagesResult.status === 'fulfilled' : volumesResult.status === 'fulfilled';
    return currentSucceeded;
  } catch (error) {
    if (generation === refreshGeneration) { state.inventoryFresh = fresh; state.error = readableError(error, msg('loadFailed', { resource: viewMessage(state.view) })); }
    return false;
  } finally {
    if (generation === refreshGeneration) {
      state.loading = false;
      state.updating = false;
      await renderSafely();
    }
  }
}

async function submitCreateContainer(event: PluginUIActionEvent): Promise<void> {
  const data = event.form_data ?? {};
  const name = clean(data.name);
  const image = clean(data.image);
  if (!name) return dialogError(msg('nameRequired'));
  if (!image) return dialogError(msg('imageRequired'));
  let request: CreateRequest;
  try {
    const cpu = optionalNumber(data.cpu_count);
    const memoryMB = optionalInteger(data.memory_mb);
    const command = parseCommandRows(data);
    const env = parseEnvironmentRows(data);
    const ports = parsePortRows(data);
    const mounts = parseMountRows(data);
    const capAdd = tokens(data.cap_add);
    const capDrop = tokens(data.cap_drop);
    const devices = parseDeviceRows(data);
    request = {
      engine: state.engine,
      image,
      name,
      ...(command ? { command } : {}),
      ...(env ? { env } : {}),
      ...(clean(data.restart_policy) ? { restart_policy: clean(data.restart_policy) } : {}),
      ...(clean(data.network_mode) ? { network_mode: clean(data.network_mode) } : {}),
      ...(ports ? { ports } : {}),
      ...(mounts ? { mounts } : {}),
      ...(cpu === undefined ? {} : { cpu_count: cpu }),
      ...(memoryMB === undefined ? {} : { memory_bytes: memoryMB * 1024 * 1024 }),
      ...(clean(data.pid_mode) ? { pid_mode: clean(data.pid_mode) } : {}),
      ...(clean(data.ipc_mode) ? { ipc_mode: clean(data.ipc_mode) } : {}),
      ...(capAdd ? { cap_add: capAdd } : {}),
      ...(capDrop ? { cap_drop: capDrop } : {}),
      ...(devices ? { devices } : {}),
      privileged: data.privileged === 'on',
    };
  } catch {
    return dialogError(msg('invalidCreateConfiguration'));
  }
  await loadPlan(msg('reviewContainerCreation'), { kind: 'create-container', request }, () => client.createPreflight(request));
}

async function submitPullImage(event: PluginUIActionEvent): Promise<void> {
  const image = clean(event.form_data?.image_ref);
  if (!image) return dialogError(msg('imageRequired'));
  const existed = imageExists(image);
  state.dialog = { kind: 'none' };
  await runOperation(`pull:${state.engine}:${image}`, msg('pullTarget', { target: image }), literal(image), () => client.pullImage({ engine: state.engine, image_ref: image }), (status) => reconcileImagePresence(image, true, existed, status));
}

async function submitTagImage(event: PluginUIActionEvent): Promise<void> {
  if (state.dialog.kind !== 'tag-image') return;
  const tag = clean(event.form_data?.tag);
  if (!tag) return dialogError(msg('tagRequired'));
  const image = state.dialog.image;
  const existed = imageExists(tag);
  state.dialog = { kind: 'none' };
  await runOperation(`tag:${state.engine}:${image}`, msg('tagTarget', { target: image }), literal(image), () => client.tagImage({ engine: state.engine, image, tag }), (status) => reconcileImagePresence(tag, true, existed, status));
}

async function submitCreateVolume(event: PluginUIActionEvent): Promise<void> {
  const name = clean(event.form_data?.name);
  const driver = clean(event.form_data?.driver);
  if (!name) return dialogError(msg('volumeNameRequired'));
  let options: Array<{ key: string; value: string }> | undefined;
  try { options = parseOptionRows(event.form_data ?? {}); }
  catch { return dialogError(msg('invalidVolumeOptions')); }
  await loadPlan(msg('reviewVolumeCreation'), { kind: 'create-volume', name, driver, options }, () => client.createVolumePreflight({ engine: state.engine, name, driver: driver || undefined, options }));
}

async function submitRemoveContainer(event: PluginUIActionEvent): Promise<void> {
  if (state.dialog.kind !== 'remove-container') return;
  const current = state.dialog;
  const force = event.form_data?.force === 'on';
  const confirmationName = clean(event.form_data?.confirmation_name);
  if (current.running && (!force || confirmationName !== current.containerName)) return dialogError(msg('confirmationNameMismatch'));
  await loadPlan(msg('reviewContainerRemoval'), { kind: 'remove-container', containerID: current.containerID, force, confirmationName }, () => client.removePreflight({ engine: state.engine, container_id: current.containerID, force, confirmation_name: confirmationName || undefined }));
}

async function submitRemoveImage(event: PluginUIActionEvent): Promise<void> {
  if (state.dialog.kind !== 'remove-image') return;
  const current = state.dialog;
  const force = event.form_data?.force === 'on';
  const confirmationName = clean(event.form_data?.confirmation_name);
  if (current.references > 0 && (!force || confirmationName !== current.image)) return dialogError(msg('confirmationNameMismatch'));
  await loadPlan(msg('reviewImageRemoval'), { kind: 'remove-image', image: current.image, force, confirmationName }, () => client.removeImagePreflight({ engine: state.engine, image: current.image, force, confirmation_name: confirmationName || undefined }));
}

async function confirmPlan(): Promise<void> {
  if (state.dialog.kind !== 'plan' || state.dialog.busy) return;
  const dialog = state.dialog;
  state.dialog = { ...dialog, busy: true, error: undefined };
  await renderSafely();
  const intent = dialog.intent;
  try {
    switch (intent.kind) {
      case 'create-container': {
        const existed = state.containers.some((item) => item.name === intent.request.name);
        await runOperation(`create:${state.engine}:${intent.request.name}`, msg('createContainer'), literal(intent.request.name!), () => client.create(intent.request), (status) => reconcileCreatedContainer(intent.request.name!, existed, status));
        break;
      }
      case 'start-container':
        await runContainerStateOperation(intent.containerID, msg('actionContainer', { action: msg('start') }), 'running', () => client.start({ engine: state.engine, container_id: intent.containerID }));
        break;
      case 'remove-container':
        await runRemovalOperation('container', intent.containerID, msg('actionContainer', { action: msg('remove') }), () => client.remove({ engine: state.engine, container_id: intent.containerID, force: intent.force, confirmation_name: intent.confirmationName || undefined }));
        break;
      case 'prune-images':
        await runOperation(`prune:${state.engine}:images`, msg('pruneUnusedImages'), msg('unusedImages'), () => client.pruneImages({ engine: state.engine, resource_identities: resourceIdentities(dialog.plan) }), (status) => reconcilePrunedImages(resourceIdentities(dialog.plan), status));
        break;
      case 'create-volume': {
        const existed = volumeExists(intent.name);
        await runOperation(`volume:${state.engine}:${intent.name}`, msg('createVolume'), literal(intent.name), () => client.createVolume({ engine: state.engine, name: intent.name, driver: intent.driver || undefined, options: intent.options }), (status) => reconcileVolumePresence(intent.name, true, existed, status));
        break;
      }
      case 'remove-volume':
        await runRemovalOperation('volume', intent.name, msg('remove'), () => client.removeVolume({ engine: state.engine, name: intent.name, confirmation_name: intent.name }));
        break;
      case 'prune-volumes':
        await runOperation(`prune:${state.engine}:volumes`, msg('pruneUnusedVolumes'), msg('unusedVolumes'), () => client.pruneVolumes({ engine: state.engine, resource_identities: resourceIdentities(dialog.plan) }), (status) => reconcilePrunedVolumes(resourceIdentities(dialog.plan), status));
        break;
      case 'remove-image':
        await runRemovalOperation('image', intent.image, msg('remove'), () => client.removeImage({ engine: state.engine, image: intent.image, force: intent.force, confirmation_name: intent.confirmationName || undefined }));
        break;
      case 'direct':
        await executeDirect(intent.method, intent.target);
        break;
    }
  } catch (error) {
    state.dialog = { ...dialog, busy: false, error: readableError(error, msg('submitFailed')) };
    await renderSafely();
  }
}

async function containerAction(event: PluginUIActionEvent): Promise<void> {
  const [method, containerID] = splitValue(event.value);
  if (!containerID) return;
  if (method === 'start') return loadPlan(msg('reviewContainerStart'), { kind: 'start-container', containerID }, () => client.startPreflight({ engine: state.engine, container_id: containerID }));
  if (method === 'remove') {
    const item = state.containers.find((container) => container.container_id === containerID);
    if (!item) return;
    if (['running', 'paused', 'restarting'].includes(item.state)) return openDialog({ kind: 'remove-container', containerID, containerName: item.name || containerID, running: true });
    const confirmationName = item.name || containerID;
    return loadPlan(msg('reviewContainerRemoval'), { kind: 'remove-container', containerID, force: false, confirmationName }, () => client.removePreflight({ engine: state.engine, container_id: containerID, force: false, confirmation_name: confirmationName }));
  }
  if (method === 'stop' || method === 'restart' || method === 'pause' || method === 'unpause' || method === 'kill') {
    return openDirectPlan(msg('actionContainer', { action: directActionMessage(method) }), method, containerID);
  }
}

async function executeDirect(method: DirectMethod, target: string): Promise<void> {
  state.dialog = { kind: 'none' };
  const request = { engine: state.engine, container_id: target } as const;
  if (method === 'stop') return runContainerStateOperation(target, msg('actionContainer', { action: msg('stop') }), 'inactive', () => client.stop(request));
  if (method === 'restart') return runContainerStateOperation(target, msg('actionContainer', { action: msg('restart') }), 'running', () => client.restart(request), false);
  if (method === 'pause') return runContainerStateOperation(target, msg('actionContainer', { action: msg('pause') }), 'paused', () => client.pause(request));
  if (method === 'unpause') return runContainerStateOperation(target, msg('actionContainer', { action: msg('resume') }), 'running', () => client.unpause(request));
  if (method === 'kill') return runContainerStateOperation(target, msg('actionContainer', { action: msg('kill') }), 'inactive', () => client.kill(request));
}

async function containerDetails(event: PluginUIActionEvent): Promise<void> {
  const id = clean(event.value); if (id) await openContainerInspector(id, 'overview');
}

async function containerStats(event: PluginUIActionEvent): Promise<void> {
  const id = clean(event.value); if (id) await openContainerInspector(id, 'usage');
}

async function containerLogs(event: PluginUIActionEvent): Promise<void> {
  const id = clean(event.value); if (id) await openContainerInspector(id, 'logs');
}

async function selectInspectorTab(event: PluginUIActionEvent): Promise<void> {
  const [tab, id] = splitValue(event.value);
  if ((tab === 'overview' || tab === 'usage' || tab === 'logs') && id) await openContainerInspector(id, tab);
}

async function openContainerInspector(id: string, tab: InspectorTab): Promise<void> {
  await cancelDetailStream();
  state.dialog = { kind: 'details', title: msg('containerDetails'), returnKey: `container-${id}`, containerID: id, tab, body: () => stateMessage(c('loading')) };
  await renderSafely();
  try {
    if (tab === 'overview') {
      const result: ContainersInspectResponse = await client.inspect({ engine: state.engine, container_id: id });
      const item = result.container;
      state.dialog = { kind: 'details', title: msg('containerDetails'), returnKey: `container-${id}`, containerID: id, tab, body: () => detailSections([
        [c('overview'), [[c('state'), localizeStatus(item.state)], [c('health'), localizeHealth(item.health)], [c('image'), item.image.reference || item.image.digest || c('unknown')], [c('created'), formatDate(item.created_at_unix_ms)], [c('ports'), (item.ports ?? []).map((p) => `${p.host_port || '*'}:${p.port}/${p.protocol || 'tcp'}`).join(', ') || c('none')]]],
        [c('configuration'), [[c('restartPolicy'), item.runtime.restart_policy || c('none')], [c('networkMode'), item.runtime.network_mode || c('defaultValue')], [c('pidMode'), item.runtime.pid_mode || c('defaultValue')], [c('ipcMode'), item.runtime.ipc_mode || c('defaultValue')], [c('environmentVariables'), c('entryCount', { count: item.runtime.env.total })], [c('mounts'), c('entryCount', { count: item.runtime.mounts?.length ?? 0 })], [c('devices'), c('entryCount', { count: item.runtime.devices?.length ?? 0 })], [c('linuxCapabilities'), c('entryCount', { count: (item.runtime.cap_add?.length ?? 0) + (item.runtime.cap_drop?.length ?? 0) })]]],
        [c('rawIdentifiers'), [[c('containerId'), item.container_id], [c('digest'), item.image.digest || c('unpinned')]]],
      ]) };
    } else if (tab === 'usage') {
      state.dialog = { kind: 'details', title: msg('containerDetails'), returnKey: `container-${id}`, containerID: id, tab, body: () => statsDetails(id) };
      const stream = await client.statsWatch({ engine: state.engine, container_id: id, interval_ms: 2000 });
      activeDetailStream = stream as AnyStream;
      void consumeStats(stream, id);
    } else {
      state.liveLogs.set(id, []);
      state.dialog = { kind: 'details', title: msg('containerDetails'), returnKey: `container-${id}`, containerID: id, tab, body: () => el('log-output', 'pre', { class: 'log-output', 'aria-live': 'polite' }, [txt('log-output-text', state.liveLogs.get(id)?.join('\n') || c('noLogLines'))]) };
      const stream = await client.tailLogs({ engine: state.engine, container_id: id, tail_lines: 200, follow: true });
      activeDetailStream = stream as AnyStream;
      void consumeLogs(stream, id);
    }
  } catch (error) {
    const message = readableError(error, msg('detailsUnavailable'));
    state.dialog = { kind: 'details', title: msg('containerDetails'), returnKey: `container-${id}`, containerID: id, tab, body: () => stateMessage(messageText(message), true) };
  }
  await renderSafely();
}

function statsDetails(id: string): PluginUIVNode {
  const stats = state.containerStats.get(id);
  if (!stats) return stateMessage(c('loading'));
  return detailSections([
    [c('overview'), [[c('cpu'), `${stats.cpu_percent.toFixed(1)}%`], [c('memory'), `${formatBytes(stats.memory_bytes)} / ${formatBytes(stats.memory_limit)}`]]],
    [c('networkUsage'), [[c('networkReceived'), formatBytes(stats.network_rx_bytes)], [c('networkSent'), formatBytes(stats.network_tx_bytes)]]],
  ]);
}

async function consumeStats(stream: Awaited<ReturnType<typeof client.statsWatch>>, id: string): Promise<void> {
  try {
    for await (const item of stream) {
      if (disposed || activeDetailStream !== stream) return;
      state.containerStats.set(id, item.data);
      await renderSafely();
    }
  } catch (error) {
    if (!disposed && activeDetailStream === stream) {
      state.notice = readableError(error, msg('observationPausedDetail'));
      await renderSafely();
    }
  } finally {
    if (activeDetailStream === stream) activeDetailStream = undefined;
  }
}

async function consumeLogs(stream: Awaited<ReturnType<typeof client.tailLogs>>, id: string): Promise<void> {
  try {
    for await (const item of stream) {
      if (disposed || activeDetailStream !== stream) return;
      const lines = state.liveLogs.get(id) ?? [];
      lines.push(item.data.message);
      if (lines.length > 1000) lines.splice(0, lines.length - 1000);
      state.liveLogs.set(id, lines);
      await renderSafely();
    }
  } catch (error) {
    if (!disposed && activeDetailStream === stream) {
      state.notice = readableError(error, msg('observationPausedDetail'));
      await renderSafely();
    }
  } finally {
    if (activeDetailStream === stream) activeDetailStream = undefined;
  }
}

async function imageDetails(event: PluginUIActionEvent): Promise<void> {
  const image = clean(event.value); if (!image) return;
  await withDetails(msg('imageDetails'), `image-${image}`, async () => {
    const result: ImageResponse = await client.inspectImage({ engine: state.engine, image });
    return () => detailSections([[c('overview'), [[c('reference'), result.image.reference || image], [c('digest'), result.image.digest || c('unpinned')], [c('size'), formatBytes(result.image.size_bytes)], [c('created'), formatDate(result.image.created_at_unix_ms)], [c('usedBy'), c('containerCount', { count: result.image.referenced_containers })]]], [c('rawIdentifiers'), [[c('imageId'), result.image.id]]]]);
  });
}

async function imageHistory(event: PluginUIActionEvent): Promise<void> {
  const image = clean(event.value); if (!image) return;
  await withDetails(msg('imageHistory'), `image-${image}`, async () => {
    const result: HistoryResponse = await client.imageHistory({ engine: state.engine, image });
    return () => el('history-list', 'ol', { class: 'history-list' }, result.history.map((item, index) => el(`history-${index}`, 'li', {}, [
      el(`history-${index}-identity`, 'code', {}, [txt(`history-${index}-identity-text`, item.id || c('layer'))]),
      el(`history-${index}-size`, 'span', {}, [txt(`history-${index}-size-text`, formatBytes(item.size_bytes))]),
    ])));
  });
}

async function openImageTag(event: PluginUIActionEvent): Promise<void> {
  const image = clean(event.value); if (image) await openDialog({ kind: 'tag-image', image });
}

async function removeImage(event: PluginUIActionEvent): Promise<void> {
  const image = clean(event.value); if (!image) return;
  const references = state.images.find((item) => imageName(item) === image)?.referenced_containers ?? 0;
  if (references > 0) await openDialog({ kind: 'remove-image', image, references });
  else await loadPlan(msg('reviewImageRemoval'), { kind: 'remove-image', image, force: false, confirmationName: image }, () => client.removeImagePreflight({ engine: state.engine, image, force: false, confirmation_name: image }));
}

async function pruneImages(): Promise<void> {
  await loadPlan(msg('reviewImagePrune'), { kind: 'prune-images' }, () => client.pruneImagesPreflight({ engine: state.engine }));
}

async function volumeDetails(event: PluginUIActionEvent): Promise<void> {
  const name = clean(event.value); if (!name) return;
  await withDetails(msg('volumeDetails'), `volume-${name}`, async () => {
    const result: VolumeResponse = await client.inspectVolume({ engine: state.engine, name });
    return () => detailSections([[c('overview'), [[c('name'), result.volume.name], [c('driver'), result.volume.driver || c('defaultDriver')], [c('scope'), result.volume.scope || c('local')], [c('created'), formatDate(result.volume.created_at_unix_ms)], [c('usedBy'), c('containerCount', { count: result.volume.referenced_containers })]]]]);
  });
}

async function removeVolume(event: PluginUIActionEvent): Promise<void> {
  const name = clean(event.value); if (!name) return;
  await loadPlan(msg('reviewVolumeRemoval'), { kind: 'remove-volume', name }, () => client.removeVolumePreflight({ engine: state.engine, name, confirmation_name: name }));
}

async function pruneVolumes(): Promise<void> {
  await loadPlan(msg('reviewVolumePrune'), { kind: 'prune-volumes' }, () => client.pruneVolumesPreflight({ engine: state.engine }));
}

async function loadPlan(titleText: Message, intent: Intent, loader: () => Promise<Plan>): Promise<void> {
  state.dialog = { kind: 'plan', title: titleText, plan: { method: '' }, summary: [msg('preparingPlanMessage')], intent, busy: true };
  await renderSafely();
  try {
    const plan = await loader();
    state.dialog = { kind: 'plan', title: titleText, plan, intent, busy: false };
  } catch (error) {
    state.dialog = { kind: 'plan', title: titleText, plan: { method: '' }, intent, busy: false, error: readableError(error, msg('planFailed')) };
  }
  await renderSafely();
}

async function openDirectPlan(titleText: Message, method: DirectMethod, target: string): Promise<void> {
  state.dialog = { kind: 'plan', title: titleText, plan: { method, risk_level: method === 'kill' || method.includes('remove') ? 'high' : 'medium' }, summary: [msg('directPlanSummary', { action: titleText, target })], intent: { kind: 'direct', method, target }, busy: false };
  await renderSafely();
}

async function runContainerStateOperation(containerID: string, label: Message, desired: 'running' | 'paused' | 'inactive', submit: () => Promise<AnyOperation>, allowUnchangedFailure = true): Promise<void> {
  const before = state.containers.find((item) => item.container_id === containerID)?.state;
  await runOperation(`container:${state.engine}:${containerID}`, label, literal(containerID), submit, (status) => reconcileContainerState(containerID, desired, before, status, allowUnchangedFailure));
}

async function runRemovalOperation(kind: 'container' | 'image' | 'volume', identityValue: string, label: Message, submit: () => Promise<AnyOperation>): Promise<void> {
  const existed = kind === 'container' ? state.containers.some((item) => item.container_id === identityValue) : kind === 'image' ? imageExists(identityValue) : volumeExists(identityValue);
  const reconcile = kind === 'container'
    ? (status?: string) => reconcileContainerPresence(identityValue, false, existed, status)
    : kind === 'image'
      ? (status?: string) => reconcileImagePresence(identityValue, false, existed, status)
      : (status?: string) => reconcileVolumePresence(identityValue, false, existed, status);
  await runOperation(`${kind}:${state.engine}:${identityValue}`, label, literal(identityValue), submit, reconcile);
}

async function runOperation(key: string, label: Message, target: Message, submit: () => Promise<AnyOperation>, reconcile?: (terminalStatus?: string) => Promise<ReconcileResult>): Promise<void> {
  if (state.operations.has(key)) return;
  state.dialog = { kind: 'none' };
  state.operations.set(key, { key, label, target, operationID: '', status: msg('submitting'), reconcile });
  await renderSafely();
  try {
    const operation = await submit();
    const record = state.operations.get(key);
    if (!record || disposed) return;
    record.operationID = operation.operation_id;
    record.status = msg('running');
    record.handle = operation;
    await renderSafely();
    await observeOperation(record, operation, reconcile);
  } catch (error) {
    const record = state.operations.get(key);
    const policy = submissionFailurePolicy(mutationOutcome(error));
    if (policy.retryAllowed) {
      state.operations.delete(key);
      state.notice = readableError(error, msg('operationNotSubmitted'));
    } else if (record) {
      record.status = msg('submissionBlocked');
      record.error = readableError(error, msg('operationNotSubmitted'));
    }
    await renderSafely();
  }
}

async function resumeOperation(event: PluginUIActionEvent): Promise<void> {
  const record = state.operations.get(clean(event.value));
  if (!record?.handle || !record.reconcile || !record.error || record.observation) return;
  record.error = undefined;
  record.status = msg('running');
  await renderSafely();
  await observeOperation(record, record.handle, record.reconcile);
}

async function cancelOperation(event: PluginUIActionEvent): Promise<void> {
  const key = clean(event.value);
  const record = state.operations.get(key);
  if (!record?.handle || isMessageKey(record.status, 'cancelRequested')) return;
  record.status = msg('cancelRequested');
  await renderSafely();
  try {
    await record.handle.cancel('user requested cancellation');
  } catch (error) {
    const policy = cancellationFailurePolicy(mutationOutcome(error));
    record.status = policy.retryAllowed ? msg('running') : msg('cancellationUncertain');
    record.error = policy.retryAllowed ? undefined : msg('cancellationUncertainDetail');
    await renderSafely();
  }
}

async function observeOperation(record: OperationRecord, operation: AnyOperation, reconcile?: (terminalStatus?: string) => Promise<ReconcileResult>): Promise<void> {
  if (record.observation || disposed) return;
  const observation = new AbortController();
  record.observation = observation;
  let terminal = false;
  const poll = async (): Promise<void> => {
    while (!terminal && !observation.signal.aborted) {
      try {
        const snapshot = await operation.snapshot({ signal: observation.signal });
        const current = state.operations.get(record.key);
        if (!current) return;
        current.progress = snapshot.progress;
        current.status = snapshot.progress?.phase ? progressPhaseMessage(snapshot.progress.phase) : statusMessage(snapshot.status);
        await renderSafely();
        if (!['running', 'cancel_requested'].includes(snapshot.status)) return;
      } catch { return; }
      await delay(500);
    }
  };
  void poll();
  try {
    const result = await operation.wait({ signal: observation.signal, timeoutMs: 660_000, pollIntervalMs: 500 });
    terminal = true;
    observation.abort();
    const current = state.operations.get(record.key);
    if (current) current.status = statusMessage(result.status);
    state.notice = msg('operationResult', { operation: record.label, status: statusMessage(result.status) });
    const reconciled = await refresh();
    let exactReconciliation: ReconcileResult = { complete: reconciled };
    if (reconcile) {
      try { exactReconciliation = await reconcile(result.status); } catch { exactReconciliation = { complete: false }; }
    }
    if (!exactReconciliation.complete) {
      const current = state.operations.get(record.key);
      if (current) {
        current.status = msg('reconciliationRequired');
        current.error = exactReconciliation.detail ?? msg('reconciliationRequiredDetail');
      }
      await renderSafely();
      return;
    }
    if (exactReconciliation.detail) state.notice = exactReconciliation.detail;
    await renderSafely();
    await delay(900);
    state.operations.delete(record.key);
  } catch (error) {
    terminal = true;
    if (observation.signal.aborted) return;
    observation.abort();
    await refresh();
    let exactReconciliation: ReconcileResult | undefined;
    if (reconcile) {
      try { exactReconciliation = await reconcile(); } catch { exactReconciliation = { complete: false }; }
    }
    const current = state.operations.get(record.key);
    if (current && exactReconciliation?.complete) {
      current.status = msg('statusCompleted');
      current.error = undefined;
      state.notice = exactReconciliation.detail;
      await renderSafely();
      await delay(900);
      state.operations.delete(record.key);
    } else if (current) {
      current.status = exactReconciliation ? msg('reconciliationRequired') : msg('observationPaused');
      current.error = exactReconciliation?.detail ?? readableError(error, msg('observationPausedDetail'));
    }
  } finally {
    terminal = true;
    observation.abort();
    if (record.observation === observation) record.observation = undefined;
    await renderSafely();
  }
}

async function reconcileCreatedContainer(name: string, existed: boolean, terminalStatus?: string): Promise<ReconcileResult> {
  if (!state.inventoryFresh.containers || state.viewErrors.containers) return { complete: false };
  const matches = state.containers.filter((item) => item.name === name);
  if (matches.length === 0) return presenceReconciliation(false, true, existed, terminalStatus);
  if (matches.length !== 1) return { complete: false };
  const result = await client.inspect({ engine: state.engine, container_id: matches[0].container_id });
  const present = result.container.container_id === matches[0].container_id && result.container.name === name;
  return presenceReconciliation(present, true, existed, terminalStatus);
}

function reconcileContainerPresence(identityValue: string, desired: boolean, existed: boolean, terminalStatus?: string): Promise<ReconcileResult> { if (!state.inventoryFresh.containers || state.viewErrors.containers) return Promise.resolve({ complete: false }); return Promise.resolve(presenceReconciliation(state.containers.some((item) => item.container_id === identityValue), desired, existed, terminalStatus)); }
function reconcileImagePresence(identityValue: string, desired: boolean, existed: boolean, terminalStatus?: string): Promise<ReconcileResult> { if (!state.inventoryFresh.images || state.viewErrors.images || state.partialFailures.images > 0) return Promise.resolve({ complete: false }); return Promise.resolve(presenceReconciliation(imageExists(identityValue), desired, existed, terminalStatus)); }
function reconcileVolumePresence(identityValue: string, desired: boolean, existed: boolean, terminalStatus?: string): Promise<ReconcileResult> { if (!state.inventoryFresh.volumes || state.viewErrors.volumes || state.partialFailures.volumes > 0) return Promise.resolve({ complete: false }); return Promise.resolve(presenceReconciliation(volumeExists(identityValue), desired, existed, terminalStatus)); }
function reconcileContainerState(containerID: string, desired: 'running' | 'paused' | 'inactive', before: string | undefined, terminalStatus?: string, allowUnchangedFailure = true): Promise<ReconcileResult> {
  if (!state.inventoryFresh.containers || state.viewErrors.containers) return Promise.resolve({ complete: false });
  const current = state.containers.find((item) => item.container_id === containerID)?.state;
  const reached = desired === 'inactive' ? Boolean(current && !['running', 'paused', 'restarting'].includes(current)) : current === desired;
  const beforeReached = desired === 'inactive' ? Boolean(before && !['running', 'paused', 'restarting'].includes(before)) : before === desired;
  const changedToDesired = reached && !beforeReached;
  const completedAtDesired = terminalStatus === 'completed' && reached;
  const provenUnchangedFailure = allowUnchangedFailure && failedTerminal(terminalStatus) && current === before && !beforeReached;
  return Promise.resolve({ complete: changedToDesired || completedAtDesired || provenUnchangedFailure });
}
function presenceReconciliation(current: boolean, desired: boolean, before: boolean, terminalStatus?: string): ReconcileResult { const changedToDesired = current === desired && before !== desired; const completedAtDesired = terminalStatus === 'completed' && current === desired; const provenUnchangedFailure = failedTerminal(terminalStatus) && current === before && before !== desired; return { complete: changedToDesired || completedAtDesired || provenUnchangedFailure }; }
function failedTerminal(status?: string): boolean { return status === 'failed' || status === 'canceled' || status === 'cancelled'; }
function imageExists(identityValue: string): boolean { return state.images.some((item) => item.id === identityValue || item.digest === identityValue || item.reference === identityValue || item.tags?.includes(identityValue)); }
function volumeExists(identityValue: string): boolean { return state.volumes.some((item) => item.name === identityValue); }

function reconcilePrunedImages(identities: string[], terminalStatus?: string): Promise<ReconcileResult> { if (!state.inventoryFresh.images || state.viewErrors.images || state.partialFailures.images > 0) return Promise.resolve({ complete: false }); return Promise.resolve(pruneReconciliation(identities, terminalStatus, (identity) => state.images.some((item) => item.id === identity || item.digest === identity || item.reference === identity || item.tags?.includes(identity)))); }
function reconcilePrunedVolumes(identities: string[], terminalStatus?: string): Promise<ReconcileResult> { if (!state.inventoryFresh.volumes || state.viewErrors.volumes || state.partialFailures.volumes > 0) return Promise.resolve({ complete: false }); return Promise.resolve(pruneReconciliation(identities, terminalStatus, (identity) => state.volumes.some((item) => item.name === identity))); }
function pruneReconciliation(identities: string[], terminalStatus: string | undefined, remains: (identity: string) => boolean): ReconcileResult { const remaining = identities.filter(remains).length; const unchangedTerminal = remaining === identities.length && (terminalStatus === 'failed' || terminalStatus === 'canceled' || terminalStatus === 'cancelled'); return { complete: identities.length > 0 && (remaining === 0 || unchangedTerminal), detail: msg('pruneReconciliation', { removed: identities.length - remaining, remaining }) }; }

async function withDetails(titleText: Message, returnKey: string, load: () => Promise<() => PluginUIVNode>): Promise<void> {
  await cancelDetailStream();
  state.dialog = { kind: 'details', title: titleText, body: () => stateMessage(c('loading')), returnKey };
  await renderSafely();
  try { state.dialog = { kind: 'details', title: titleText, body: await load(), returnKey }; }
  catch (error) { const message = readableError(error, msg('detailsUnavailable')); state.dialog = { kind: 'details', title: titleText, body: () => stateMessage(messageText(message), true), returnKey }; }
  await renderSafely();
}

async function openDialog(dialog: Dialog): Promise<void> {
  if (dialog.kind === 'create-container' || dialog.kind === 'create-volume') resetFormRows();
  state.dialog = dialog;
  await renderSafely();
}
async function closeDialog(): Promise<void> { await cancelDetailStream(); state.dialog = { kind: 'none' }; await renderSafely(); }
async function cancelDetailStream(): Promise<void> {
  const stream = activeDetailStream;
  activeDetailStream = undefined;
  if (!stream) return;
  try { await stream.cancel('detail closed'); } catch { /* Terminal reconciliation remains owned by ReDevPlugin. */ }
}
function dialogError(message: Message): void { if (state.dialog.kind !== 'none' && state.dialog.kind !== 'details') state.dialog = { ...state.dialog, error: message } as Dialog; void renderSafely(); }

function render(): Promise<void> {
  if (disposed) return Promise.resolve();
  const context = state.context;
  return bridge.render(el('containers-root', 'main', {
    class: 'containers-app', lang: context?.locale.language_tag ?? 'en-US', dir: context?.locale.direction ?? 'ltr',
  }, [appHeader(), statusBar(), operationsBar(), resourceContent(), dialog()]));
}

function appHeader(): PluginUIVNode {
  return el('app-header', 'header', { class: 'app-header' }, [
    el('brand', 'div', { class: 'brand' }, [el('brand-mark', 'span', { class: 'brand-mark', 'aria-hidden': true }), el('brand-copy', 'div', {}, [el('brand-title', 'h1', {}, [txt('brand-title-text', c('appTitle'))]), el('brand-subtitle', 'p', {}, [txt('brand-subtitle-text', c('runtimeResources'))])])]),
    el('engine-switch', 'div', { class: 'segmented', role: 'group', 'aria-label': c('containerEngine') }, (['docker', 'podman'] as Engine[]).map((engine) => button(`engine-${engine}`, title(engine), 'select-engine', engine, state.engine === engine ? 'segment active' : 'segment', state.loading, { 'aria-pressed': state.engine === engine }))),
  ]);
}

function statusBar(): PluginUIVNode {
  return el('status-bar', 'div', { class: `status-bar ${state.error ? 'error' : state.available ? 'healthy' : ''}`, role: 'status' }, [
    el('status-dot', 'span', { class: 'status-dot', 'aria-hidden': true }),
    el('status-copy', 'span', {}, [txt('status-copy-text', state.error ? messageText(state.error) : (state.available ? `${title(state.engine)} ${state.version || c('ready')}` : c('unavailable', { engine: title(state.engine) })))]),
    state.notice ? el('notice', 'span', { class: 'notice' }, [txt('notice-text', messageText(state.notice))]) : empty('notice-empty'),
    button('refresh', state.loading ? c('refreshing') : c('refresh'), 'refresh-resources', '', 'icon-button', state.loading, { 'aria-label': c('refreshResources'), title: c('refreshResources') }),
  ]);
}

function operationsBar(): PluginUIVNode {
  const records = [...state.operations.values()];
  if (!records.length) return empty('operations-empty');
  return el('operations', 'section', { class: 'operations', 'aria-label': c('activeOperations') }, records.map((record) => {
    const key = `operation-${hash(record.key)}`;
    return el(key, 'article', { class: `operation ${record.error ? 'error' : ''}` }, [
      el(`${key}-copy`, 'div', {}, [el(`${key}-title`, 'strong', {}, [txt(`${key}-title-text`, messageText(record.label))]), el(`${key}-target`, 'span', {}, [txt(`${key}-target-text`, messageText(record.target))])]),
      el(`${key}-status`, 'span', { class: 'operation-status' }, [txt(`${key}-status-text`, messageText(record.error ?? record.status))]),
      record.progress?.total_units ? el(`${key}-progress`, 'progress', { value: record.progress.completed_units ?? 0, max: record.progress.total_units }, []) : empty(`${key}-progress-empty`),
      record.handle && record.error && record.reconcile
        ? button(`${key}-resume`, c('resume'), 'resume-operation', record.key, 'operation-cancel', Boolean(record.observation))
        : record.handle && !record.error
          ? button(`${key}-cancel`, c('cancel'), 'cancel-operation', record.key, 'operation-cancel', isMessageKey(record.status, 'cancelRequested'))
          : empty(`${key}-operation-action-empty`),
    ]);
  }));
}

function resourceContent(): PluginUIVNode {
  return el('workspace', 'section', { class: 'workspace' }, [
    el('view-tabs', 'nav', { class: 'view-tabs', 'aria-label': c('containerResources') }, (['containers', 'images', 'volumes'] as View[]).map((view) => el(`view-${view}`, 'button', { type: 'button', value: view, class: state.view === view ? 'view-tab active' : 'view-tab', 'data-redevplugin-action': 'select-view', 'aria-pressed': state.view === view }, [txt(`view-${view}-label`, viewLabel(view)), el(`view-${view}-count`, 'span', { class: 'tab-count' }, [txt(`view-${view}-count-text`, String(viewCount(view)))])]))),
    el('resource-toolbar', 'div', { class: 'resource-toolbar' }, [
      el('resource-heading', 'div', {}, [el('resource-title', 'h2', {}, [txt('resource-title-text', viewLabel(state.view))]), el('resource-count', 'p', {}, [txt('resource-count-text', resourceCount())])]),
      el('search-label', 'label', { class: 'search' }, [el('search-label-copy', 'span', { class: 'sr-only' }, [txt('search-label-text', searchLabel(state.view))]), el('search-input', 'input', { type: 'search', value: state.query, placeholder: searchLabel(state.view), autocomplete: 'off', 'data-redevplugin-action': 'filter-resources' })]),
      primaryActions(),
    ]),
    resourceRefinements(),
    ...inventoryNotices(),
    state.loading ? resourceSkeleton() : !state.available ? stateMessage(c('unavailableSentence', { engine: title(state.engine) }), true) : resourceList(),
  ]);
}

function resourceRefinements(): PluginUIVNode {
  const filters = filterOptions(state.view);
  const sorts = sortOptions(state.view);
  return el('resource-refinements', 'div', { class: 'resource-refinements' }, [
    el('filter-group', 'div', { class: 'filter-group', role: 'group', 'aria-label': c('filterBy') }, filters.map((item) => button(`filter-${item.value}`, item.label, 'select-filter', item.value, state.filters[state.view] === item.value ? 'filter-chip active' : 'filter-chip', false, { 'aria-pressed': state.filters[state.view] === item.value }))),
    el('sort-label', 'label', { class: 'sort-control' }, [el('sort-copy', 'span', {}, [txt('sort-copy-text', c('sortBy'))]), el('sort-select', 'select', { name: 'sort', 'data-redevplugin-action': 'select-sort' }, sorts.map((item) => el(`sort-${item.value}`, 'option', { value: item.value, selected: state.sorts[state.view] === item.value }, [txt(`sort-${item.value}-text`, item.label)])))]),
  ]);
}

function inventoryNotices(): PluginUIVNode[] {
  const notices: PluginUIVNode[] = [];
  if (state.updating) notices.push(el('updating-inventory', 'div', { class: 'inventory-notice updating', role: 'status' }, [el('updating-spinner', 'span', { class: 'notice-spinner', 'aria-hidden': true }), txt('updating-inventory-text', c('updatingResources'))]));
  const viewError = state.viewErrors[state.view];
  if (viewError) notices.push(el('stale-inventory', 'div', { class: 'inventory-notice warning', role: 'status' }, [txt('stale-inventory-text', c('staleInventory', { detail: messageText(viewError) }))]));
  const partialCount = state.view === 'containers' ? state.statsFailures : state.partialFailures[state.view];
  if (partialCount > 0) notices.push(el('partial-inventory', 'div', { class: 'inventory-notice warning', role: 'status' }, [txt('partial-inventory-text', c(state.view === 'containers' ? 'statsUnavailableCount' : 'partialInventory', { count: partialCount }))]));
  return notices;
}

function resourceSkeleton(): PluginUIVNode {
  return el('resource-skeleton', 'div', { class: 'resource-table skeleton-table', role: 'status', 'aria-label': c('loadingResources', { resource: viewLabel(state.view) }) }, Array.from({ length: 5 }, (_, index) => el(`skeleton-${index}`, 'div', { class: 'resource-row skeleton-row' }, [el(`skeleton-${index}-identity`, 'span', { class: 'skeleton-block wide' }), el(`skeleton-${index}-metric-a`, 'span', { class: 'skeleton-block' }), el(`skeleton-${index}-metric-b`, 'span', { class: 'skeleton-block' }), el(`skeleton-${index}-metric-c`, 'span', { class: 'skeleton-block' }), el(`skeleton-${index}-actions`, 'span', { class: 'skeleton-block actions' })])));
}

function primaryActions(): PluginUIVNode {
  if (state.view === 'containers') return button('create-container', c('createContainer'), 'open-create-container', '', 'primary-button');
  if (state.view === 'images') return el('image-actions', 'div', { class: 'toolbar-actions' }, [button('pull-image', c('pullImage'), 'open-pull-image', '', 'primary-button'), button('prune-images', c('prune'), 'prune-images', '', 'secondary-button', state.partialFailures.images > 0)]);
  return el('volume-actions', 'div', { class: 'toolbar-actions' }, [button('create-volume', c('createVolume'), 'open-create-volume', '', 'primary-button'), button('prune-volumes', c('prune'), 'prune-volumes', '', 'secondary-button', state.partialFailures.volumes > 0)]);
}

function resourceList(): PluginUIVNode {
  if (state.view === 'containers') return containersTable(filteredContainers());
  if (state.view === 'images') return imagesTable(filteredImages());
  return volumesTable(filteredVolumes());
}

function containersTable(items: Container[]): PluginUIVNode {
  if (!items.length) return resourceEmptyState(c(hasRefinements('containers') ? 'noMatchingContainers' : 'noContainers'), 'containers');
  return el('container-table', 'div', { class: 'resource-table' }, items.map((item) => {
    const running = item.state === 'running'; const paused = item.state === 'paused'; const id = item.container_id;
    const stats = state.containerStats.get(id);
    return el(`container-${id}`, 'article', { class: 'resource-row container-row' }, [
      identity(`container-${id}`, item.name || short(id), `${localizeStatus(item.state)} · ${localizeHealth(item.health)}`, running ? 'running' : paused ? 'paused' : 'neutral'),
      metric(`container-${id}-image`, c('image'), item.image.reference || item.image.digest || c('unknown')),
      metric(`container-${id}-ports`, c('ports'), (item.ports ?? []).map((p) => `${p.host_port || '*'}:${p.port}`).join(', ') || c('none')),
      metric(`container-${id}-usage`, c('usage'), stats ? `${stats.cpu_percent.toFixed(1)}% · ${formatBytes(stats.memory_bytes)}` : c('notAvailable')),
      metric(`container-${id}-created`, c('created'), formatDate(item.created_at_unix_ms)),
      el(`container-${id}-actions`, 'div', { class: 'row-actions' }, [
        running ? action(`container-${id}-stop`, c('stop'), 'stop', id) : paused ? action(`container-${id}-resume`, c('resume'), 'unpause', id) : action(`container-${id}-start`, c('start'), 'start', id),
        running ? action(`container-${id}-pause`, c('pause'), 'pause', id) : empty(`container-${id}-pause-empty`),
        action(`container-${id}-restart`, c('restart'), 'restart', id), action(`container-${id}-kill`, c('kill'), 'kill', id, 'danger'),
        button(`container-${id}-stats`, c('stats'), 'container-stats', id, 'row-button'), button(`container-${id}-logs`, c('logs'), 'container-logs', id, 'row-button'),
        button(`container-${id}-details`, c('details'), 'container-details', id, 'row-button'), action(`container-${id}-remove`, c('remove'), 'remove', id, 'danger'),
      ]),
    ]);
  }));
}

function imagesTable(items: Image[]): PluginUIVNode {
  if (!items.length) return resourceEmptyState(c(hasRefinements('images') ? 'noMatchingImages' : 'noImages'), 'images');
  return el('image-table', 'div', { class: 'resource-table' }, items.map((item) => {
    const ref = imageName(item);
    return el(`image-${item.id}`, 'article', { class: 'resource-row' }, [
      identity(`image-${item.id}`, ref, short(item.id), item.referenced_containers ? 'used' : 'neutral'),
      metric(`image-${item.id}-size`, c('size'), formatBytes(item.size_bytes)), metric(`image-${item.id}-used`, c('usage'), referenceCount('images', item.referenced_containers)), metric(`image-${item.id}-created`, c('created'), formatDate(item.created_at_unix_ms)),
      el(`image-${item.id}-actions`, 'div', { class: 'row-actions' }, [button(`image-${item.id}-details`, c('details'), 'image-details', ref, 'row-button'), button(`image-${item.id}-history`, c('history'), 'image-history', ref, 'row-button'), button(`image-${item.id}-tag`, c('tag'), 'image-tag', ref, 'row-button'), button(`image-${item.id}-remove`, c('remove'), 'image-remove', ref, 'row-button danger', state.partialFailures.images > 0)]),
    ]);
  }));
}

function volumesTable(items: Volume[]): PluginUIVNode {
  if (!items.length) return resourceEmptyState(c(hasRefinements('volumes') ? 'noMatchingVolumes' : 'noVolumes'), 'volumes');
  return el('volume-table', 'div', { class: 'resource-table' }, items.map((item) => el(`volume-${item.name}`, 'article', { class: 'resource-row' }, [
    identity(`volume-${item.name}`, item.name, item.driver || c('defaultDriver'), item.referenced_containers ? 'used' : 'neutral'), metric(`volume-${item.name}-scope`, c('scope'), item.scope || c('local')), metric(`volume-${item.name}-used`, c('usage'), referenceCount('volumes', item.referenced_containers)), metric(`volume-${item.name}-created`, c('created'), formatDate(item.created_at_unix_ms)),
    el(`volume-${item.name}-actions`, 'div', { class: 'row-actions' }, [button(`volume-${item.name}-details`, c('details'), 'volume-details', item.name, 'row-button'), button(`volume-${item.name}-remove`, c('remove'), 'volume-remove', item.name, 'row-button danger', item.referenced_containers > 0 || state.partialFailures.volumes > 0)]),
  ])));
}

function dialog(): PluginUIVNode {
  const current = state.dialog; if (current.kind === 'none') return empty('dialog-empty');
  let body: PluginUIVNode;
  if (current.kind === 'create-container') body = createContainerForm(current.error);
  else if (current.kind === 'pull-image') body = simpleForm('pull-image-form', 'submit-pull-image', [{ name: 'image_ref', label: c('imageReference'), placeholder: 'ghcr.io/example/app:latest', required: true }], c('pullImage'), current.error);
  else if (current.kind === 'tag-image') body = simpleForm('tag-image-form', 'submit-tag-image', [{ name: 'tag', label: c('newTag'), placeholder: 'ghcr.io/example/app:stable', required: true }], c('createTag'), current.error);
  else if (current.kind === 'create-volume') body = createVolumeForm(current.error);
  else if (current.kind === 'remove-container') body = removalForm('remove-container-form', 'submit-remove-container', current.containerName, current.running, current.error);
  else if (current.kind === 'remove-image') body = removalForm('remove-image-form', 'submit-remove-image', current.image, current.references > 0, current.error);
  else if (current.kind === 'plan') body = planBody(current);
  else body = current.body();
  const titleText = current.kind === 'details' || current.kind === 'plan' ? messageText(current.title) : current.kind === 'create-container' ? c('createContainer') : current.kind === 'pull-image' ? c('pullImage') : current.kind === 'tag-image' ? c('tagImage', { image: current.image }) : current.kind === 'create-volume' ? c('createVolume') : current.kind === 'remove-container' ? c('removeContainer') : c('removeImage');
  const isContainerInspector = current.kind === 'details' && Boolean(current.containerID);
  const panelChildren: PluginUIVNode[] = [el('dialog-header', 'header', { class: 'dialog-header' }, [el('dialog-title', 'h2', {}, [txt('dialog-title-text', titleText)]), button('dialog-close', c('close'), 'close-dialog', '', 'close-button', false, { autofocus: true, 'data-redevplugin-escape-action': 'close-dialog' })])];
  if (current.kind === 'details' && current.containerID) panelChildren.push(el('inspector-tabs', 'nav', { class: 'inspector-tabs', 'aria-label': c('containerDetails') }, (['overview', 'usage', 'logs'] as InspectorTab[]).map((tab) => button(`inspector-${tab}`, c(tab), 'select-inspector-tab', `${tab}|${current.containerID}`, current.tab === tab ? 'inspector-tab active' : 'inspector-tab', false, { 'aria-pressed': current.tab === tab }))));
  panelChildren.push(body);
  return el('dialog-backdrop', 'div', { class: 'dialog-backdrop' }, [el('dialog-panel', 'aside', { class: `dialog-panel${isContainerInspector ? ' container-inspector' : ''}`, role: 'dialog', 'aria-modal': true, 'aria-label': titleText }, panelChildren)]);
}

function createContainerForm(error?: Message): PluginUIVNode {
  return el('create-container-form', 'form', { class: 'form', 'data-redevplugin-action': 'submit-create-container', autocomplete: 'off' }, [
    field('container-name', c('name'), 'name', 'api', true), field('container-image', c('image'), 'image', 'ghcr.io/example/api:latest', true),
    repeatableSection('container-command', c('command'), 'command', commandRows()),
    repeatableSection('container-env', c('environmentVariables'), 'env', environmentRows()),
    formDisclosure('create-network', c('networkAndStorage'), [
      field('container-restart', c('restartPolicy'), 'restart_policy', 'unless-stopped'), field('container-network', c('networkMode'), 'network_mode', 'bridge'),
      repeatableSection('container-ports', c('portMappings'), 'ports', portRows()),
      repeatableSection('container-mounts', c('mounts'), 'mounts', mountRows()),
    ]),
    formDisclosure('create-resources', c('resourceLimits'), [numberField('container-cpu', c('cpuLimit'), 'cpu_count', '2', '0.1'), numberField('container-memory', c('memoryLimitMB'), 'memory_mb', '512', '1')]),
    formDisclosure('create-security', c('securityReview'), [
      field('container-pid', c('pidMode'), 'pid_mode', 'private'), field('container-ipc', c('ipcMode'), 'ipc_mode', 'private'),
      textareaField('container-cap-add', c('capabilitiesAdd'), 'cap_add', 'NET_ADMIN', 2), textareaField('container-cap-drop', c('capabilitiesDrop'), 'cap_drop', 'ALL', 2),
      repeatableSection('container-devices', c('devices'), 'devices', deviceRows()),
      el('container-privileged-label', 'label', { class: 'checkbox-field' }, [el('container-privileged', 'input', { type: 'checkbox', name: 'privileged' }), el('container-privileged-copy', 'span', {}, [txt('container-privileged-copy-text', c('privilegedAccess'))])]),
    ]),
    formFooter('create-container', c('reviewCreation'), error),
  ]);
}

function createVolumeForm(error?: Message): PluginUIVNode {
  return el('create-volume-form', 'form', { class: 'form', 'data-redevplugin-action': 'submit-create-volume', autocomplete: 'off' }, [field('create-volume-name', c('volumeName'), 'name', 'app-data'), field('create-volume-driver', c('driver'), 'driver', 'local'), repeatableSection('create-volume-options', c('driverOptions'), 'volume-options', optionRows()), formFooter('create-volume', c('reviewCreation'), error)]);
}

function repeatableSection(key: string, label: string, kind: FormRowKind, rows: PluginUIVNode[]): PluginUIVNode {
  return el(`${key}-group`, 'fieldset', { class: `repeatable-field repeatable-${kind}` }, [
    el(`${key}-legend`, 'legend', {}, [txt(`${key}-legend-text`, label)]),
    el(`${key}-rows`, 'div', { class: 'repeatable-rows' }, rows),
    button(`${key}-add`, c('addEntry'), 'add-form-row', kind, 'add-row-button', state.formRows[kind].length >= 24),
  ]);
}

function commandRows(): PluginUIVNode[] { return state.formRows.command.map((id) => repeatableRow('command', id, [compactField(`command-${id}-value`, c('argument'), `command_${id}`, 'server') ])); }
function environmentRows(): PluginUIVNode[] { return state.formRows.env.map((id) => repeatableRow('env', id, [compactField(`env-${id}-key`, c('key'), `env_key_${id}`, 'NODE_ENV'), compactField(`env-${id}-value`, c('value'), `env_value_${id}`, 'production')])); }
function portRows(): PluginUIVNode[] { return state.formRows.ports.map((id) => repeatableRow('ports', id, [compactField(`ports-${id}-host-ip`, c('hostAddress'), `ports_host_ip_${id}`, '127.0.0.1'), compactField(`ports-${id}-host-port`, c('hostPort'), `ports_host_port_${id}`, '8080', 'number'), compactField(`ports-${id}-container-port`, c('containerPort'), `ports_container_port_${id}`, '80', 'number'), compactSelect(`ports-${id}-protocol`, c('protocol'), `ports_protocol_${id}`, [['tcp', 'TCP'], ['udp', 'UDP'], ['sctp', 'SCTP']]) ])); }
function mountRows(): PluginUIVNode[] { return state.formRows.mounts.map((id) => repeatableRow('mounts', id, [compactSelect(`mounts-${id}-type`, c('mountType'), `mounts_type_${id}`, [['volume', c('volumeMount')], ['bind', c('bindMount')], ['tmpfs', 'tmpfs']]), compactField(`mounts-${id}-source`, c('source'), `mounts_source_${id}`, 'app-data'), compactField(`mounts-${id}-target`, c('target'), `mounts_target_${id}`, '/var/lib/app'), compactCheckbox(`mounts-${id}-readonly`, c('readOnly'), `mounts_readonly_${id}`)])); }
function deviceRows(): PluginUIVNode[] { return state.formRows.devices.map((id) => repeatableRow('devices', id, [compactField(`devices-${id}-host`, c('hostPath'), `devices_host_${id}`, '/dev/dri'), compactField(`devices-${id}-container`, c('containerPath'), `devices_container_${id}`, '/dev/dri'), compactField(`devices-${id}-permissions`, c('permissions'), `devices_permissions_${id}`, 'rwm')])); }
function optionRows(): PluginUIVNode[] { return state.formRows['volume-options'].map((id) => repeatableRow('volume-options', id, [compactField(`volume-options-${id}-key`, c('key'), `volume_options_key_${id}`, 'type'), compactField(`volume-options-${id}-value`, c('value'), `volume_options_value_${id}`, 'nfs')])); }

function repeatableRow(kind: FormRowKind, id: number, fields: PluginUIVNode[]): PluginUIVNode {
  return el(`${kind}-${id}-row`, 'div', { class: 'repeatable-row' }, [...fields, button(`${kind}-${id}-remove`, c('removeEntry'), 'remove-form-row', `${kind}|${id}`, 'remove-row-button', state.formRows[kind].length <= 1, { 'aria-label': c('removeEntry'), title: c('removeEntry') })]);
}
function compactField(key: string, labelText: string, name: string, placeholder: string, type = 'text'): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'compact-field' }, [el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)]), el(key, 'input', { type, name, placeholder })]); }
function compactSelect(key: string, labelText: string, name: string, options: Array<[string, string]>): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'compact-field' }, [el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)]), el(key, 'select', { name }, options.map(([value, label]) => el(`${key}-${value}`, 'option', { value }, [txt(`${key}-${value}-text`, label)])))]); }
function compactCheckbox(key: string, labelText: string, name: string): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'compact-checkbox' }, [el(key, 'input', { type: 'checkbox', name }), el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)])]); }

function removalForm(key: string, actionName: string, identityValue: string, forceRequired: boolean, error?: Message): PluginUIVNode {
  return el(key, 'form', { class: 'form removal-form', 'data-redevplugin-action': actionName, autocomplete: 'off' }, [
    el(`${key}-warning`, 'p', { class: 'destructive-warning' }, [txt(`${key}-warning-text`, forceRequired ? c('forceRemovalWarning') : c('removalWarning'))]),
    forceRequired ? el(`${key}-force-label`, 'label', { class: 'checkbox-field' }, [el(`${key}-force`, 'input', { type: 'checkbox', name: 'force' }), el(`${key}-force-copy`, 'span', {}, [txt(`${key}-force-copy-text`, c('forceRemoval'))])]) : empty(`${key}-force-empty`),
    forceRequired ? field(`${key}-confirmation`, c('typeNameToConfirm', { name: identityValue }), 'confirmation_name', identityValue, true) : empty(`${key}-confirmation-empty`),
    formFooter(key, c('reviewRemoval'), error),
  ]);
}

function planBody(current: Extract<Dialog, { kind: 'plan' }>): PluginUIVNode {
  const flags = current.plan.risk_flags ?? [];
  return el('plan-body', 'div', { class: 'plan-body' }, [
    el('plan-summary', 'div', { class: `risk-summary ${current.plan.risk_level || 'neutral'}` }, [el('plan-risk', 'strong', {}, [txt('plan-risk-text', current.busy ? c('preparingPlan') : c('planRisk', { level: riskLabel(current.plan.risk_level) }))]), el('plan-method', 'code', {}, [txt('plan-method-text', current.plan.method || 'preflight')])]),
    ...planSummaryMessages(current).map((line, i) => el(`plan-summary-${i}`, 'p', { class: 'plan-line' }, [txt(`plan-summary-${i}-text`, messageText(line))])),
    flags.length ? el('risk-flags', 'ul', { class: 'risk-flags' }, flags.map((flag, i) => { const copy = riskFlagMessages(flag); return el(`risk-${i}`, 'li', { class: `risk-${flag.severity}` }, [el(`risk-${i}-title`, 'strong', {}, [txt(`risk-${i}-title-text`, messageText(copy.title))]), copy.detail ? el(`risk-${i}-detail`, 'p', {}, [txt(`risk-${i}-detail-text`, messageText(copy.detail))]) : empty(`risk-${i}-detail-empty`)]); })) : empty('risk-flags-empty'),
    current.plan.plan_digest ? el('plan-digest', 'div', { class: 'plan-digest' }, [el('plan-digest-label', 'span', {}, [txt('plan-digest-label-text', c('exactPlanDigest'))]), el('plan-digest-value', 'code', { title: current.plan.plan_digest }, [txt('plan-digest-value-text', current.plan.plan_digest)])]) : empty('plan-digest-empty'),
    current.error ? stateMessage(messageText(current.error), true) : empty('plan-error-empty'),
    el('plan-actions', 'div', { class: 'dialog-actions' }, [button('plan-cancel', c('cancel'), 'close-dialog', '', 'secondary-button', current.busy), button('plan-confirm', current.busy ? c('working') : c('confirmContinue'), 'confirm-plan', '', 'primary-button', !canConfirmPlan(current))]),
  ]);
}

function simpleForm(key: string, actionName: string, fields: Array<{ name: string; label: string; placeholder: string; required?: boolean }>, submitLabel: string, error?: Message): PluginUIVNode {
  return el(key, 'form', { class: 'form', 'data-redevplugin-action': actionName, autocomplete: 'off' }, [...fields.map((item) => field(`${key}-${item.name}`, item.label, item.name, item.placeholder, item.required)), formFooter(key, submitLabel, error)]);
}

function formFooter(formKey: string, label: string, error?: Message): PluginUIVNode { const key = `${formKey}-footer`; return el(key, 'div', { class: 'form-footer' }, [error ? el(`${key}-error`, 'p', { class: 'form-error', role: 'alert' }, [txt(`${key}-error-text`, messageText(error))]) : empty(`${key}-error-empty`), el(`${key}-actions`, 'div', { class: 'dialog-actions' }, [button(`${key}-cancel`, c('cancel'), 'close-dialog', '', 'secondary-button'), el(`${key}-submit`, 'button', { type: 'submit', class: 'primary-button' }, [txt(`${key}-submit-text`, label)])])]); }
function field(key: string, labelText: string, name: string, placeholder: string, required = false): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'field' }, [el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)]), el(key, 'input', { type: 'text', name, placeholder, required, autocomplete: 'off' })]); }
function numberField(key: string, labelText: string, name: string, placeholder: string, step: string): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'field' }, [el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)]), el(key, 'input', { type: 'number', name, placeholder, step, min: '0', autocomplete: 'off' })]); }
function textareaField(key: string, labelText: string, name: string, placeholder: string, rows: number): PluginUIVNode { return el(`${key}-label`, 'label', { class: 'field' }, [el(`${key}-copy`, 'span', {}, [txt(`${key}-copy-text`, labelText)]), el(key, 'textarea', { name, placeholder, rows })]); }
function formDisclosure(key: string, label: string, children: PluginUIVNode[]): PluginUIVNode { return el(key, 'details', { class: 'form-disclosure' }, [el(`${key}-summary`, 'summary', {}, [txt(`${key}-summary-text`, label)]), el(`${key}-fields`, 'div', { class: 'disclosure-fields' }, children)]); }
function detailList(items: Array<[string, string]>): PluginUIVNode { return el('detail-list', 'dl', { class: 'detail-list' }, items.flatMap(([label, value], i) => [el(`detail-${i}-term`, 'dt', {}, [txt(`detail-${i}-term-text`, label)]), el(`detail-${i}-value`, 'dd', { title: value }, [txt(`detail-${i}-value-text`, value)])])); }
function detailSections(sections: Array<[string, Array<[string, string]>]>): PluginUIVNode { return el('detail-sections', 'div', { class: 'detail-sections' }, sections.map(([titleText, items], sectionIndex) => el(`detail-section-${sectionIndex}`, 'section', { class: 'detail-section' }, [el(`detail-section-${sectionIndex}-title`, 'h3', {}, [txt(`detail-section-${sectionIndex}-title-text`, titleText)]), el(`detail-section-${sectionIndex}-list`, 'dl', { class: 'detail-list' }, items.flatMap(([label, value], itemIndex) => [el(`detail-${sectionIndex}-${itemIndex}-term`, 'dt', {}, [txt(`detail-${sectionIndex}-${itemIndex}-term-text`, label)]), el(`detail-${sectionIndex}-${itemIndex}-value`, 'dd', { title: value }, [txt(`detail-${sectionIndex}-${itemIndex}-value-text`, value)])]))]))); }
function stateMessage(message: string, error = false): PluginUIVNode { return el(`state-${hash(message)}`, 'div', { class: `state-message ${error ? 'error' : ''}`, role: error ? 'alert' : 'status' }, [txt(`state-${hash(message)}-text`, message)]); }
function resourceEmptyState(message: string, view: View): PluginUIVNode { return el(`empty-${view}`, 'div', { class: 'state-message', role: 'status' }, [txt(`empty-${view}-text`, message), hasRefinements(view) ? button(`empty-${view}-reset`, c('clearFilters'), 'reset-refinements', '', 'secondary-button') : empty(`empty-${view}-reset-empty`)]); }
function identity(key: string, name: string, subtitle: string, tone: string): PluginUIVNode { return el(`${key}-identity`, 'div', { class: 'identity' }, [el(`${key}-icon`, 'span', { class: `resource-icon ${tone}`, 'aria-hidden': true }), el(`${key}-copy`, 'div', {}, [el(`${key}-name`, 'h3', { title: name }, [txt(`${key}-name-text`, name)]), el(`${key}-subtitle`, 'code', { title: subtitle }, [txt(`${key}-subtitle-text`, subtitle)])])]); }
function metric(key: string, label: string, value: string): PluginUIVNode { return el(key, 'div', { class: 'metric' }, [el(`${key}-label`, 'span', {}, [txt(`${key}-label-text`, label)]), el(`${key}-value`, 'strong', { title: value }, [txt(`${key}-value-text`, value)])]); }
function referenceCount(view: 'images' | 'volumes', count: number): string { return state.partialFailures[view] > 0 ? c('notVerified') : c('containerCount', { count }); }
function action(key: string, label: string, method: string, target: string, tone = ''): PluginUIVNode { return button(key, label, 'container-action', `${method}|${target}`, `row-button ${tone}`.trim()); }
function button(key: string, label: string, actionName: string, value = '', className = '', disabled = false, extra: Record<string, string | boolean> = {}): PluginUIVNode { return el(key, 'button', { type: 'button', class: className, disabled, value, 'data-redevplugin-action': actionName, ...extra }, [txt(`${key}-text`, label)]); }
function el(key: string, tag: PluginUIElementVNode['tag'], attributes: Record<string, string | number | boolean> = {}, children: PluginUIVNode[] = []): PluginUIVNode { return { type: 'element', key, tag, attributes, children }; }
function txt(key: string, value: string): PluginUIVNode { return { type: 'text', key, text: value }; }
function empty(key: string): PluginUIVNode { return el(key, 'span', { hidden: true }); }

function filteredContainers(): Container[] {
  const q = query(); const filter = state.filters.containers;
  return state.containers.filter((item) => (!q || match(q, item.name, item.container_id, item.image.reference, item.image.digest, item.state, localizeStatus(item.state), ...localizedSearchTerms(currentLocale(), 'containers'))) && (filter === 'all' || filter === 'running' && item.state === 'running' || filter === 'paused' && item.state === 'paused' || filter === 'stopped' && !['running', 'paused', 'restarting'].includes(item.state))).sort(containerComparator(state.sorts.containers));
}
function filteredImages(): Image[] {
  const q = query(); const filter = state.filters.images;
  return state.images.filter((item) => (!q || match(q, item.id, item.reference, item.digest, ...(item.tags ?? []), ...localizedSearchTerms(currentLocale(), 'images'))) && (filter === 'all' || filter === 'in-use' && item.referenced_containers > 0 || filter === 'unused' && state.partialFailures.images === 0 && item.referenced_containers === 0)).sort(imageComparator(state.sorts.images));
}
function filteredVolumes(): Volume[] {
  const q = query(); const filter = state.filters.volumes;
  return state.volumes.filter((item) => (!q || match(q, item.name, item.driver, item.scope, ...localizedSearchTerms(currentLocale(), 'volumes'))) && (filter === 'all' || filter === 'in-use' && item.referenced_containers > 0 || filter === 'unused' && state.partialFailures.volumes === 0 && item.referenced_containers === 0)).sort(volumeComparator(state.sorts.volumes));
}
function resourceCount(): string { const count = state.view === 'containers' ? filteredContainers().length : state.view === 'images' ? filteredImages().length : filteredVolumes().length; return c('resourceCount', { count, resource: viewLabel(state.view), engine: title(state.engine) }); }
function viewCount(view: View): number { return view === 'containers' ? state.containers.length : view === 'images' ? state.images.length : state.volumes.length; }
function hasRefinements(view: View): boolean { return query() !== '' || state.filters[view] !== 'all'; }
function filterOptions(view: View): Array<{ value: ResourceFilter; label: string }> { return view === 'containers' ? [{ value: 'all', label: c('allResources') }, { value: 'running', label: c('running') }, { value: 'paused', label: c('paused') }, { value: 'stopped', label: c('stopped') }] : [{ value: 'all', label: c('allResources') }, { value: 'in-use', label: c('inUse') }, { value: 'unused', label: c('unused') }]; }
function sortOptions(view: View): Array<{ value: SortKey; label: string }> { const options: Array<{ value: SortKey; label: string }> = [{ value: 'name', label: c('sortName') }, { value: 'created', label: c('sortCreated') }]; if (view === 'containers') options.push({ value: 'state', label: c('sortState') }, { value: 'usage', label: c('sortUsage') }); if (view === 'images') options.push({ value: 'size', label: c('sortSize') }, { value: 'usage', label: c('sortUsage') }); if (view === 'volumes') options.push({ value: 'usage', label: c('sortUsage') }); return options; }
function query(): string { return state.query.normalize('NFKC').trim().toLocaleLowerCase(currentLanguageTag()); }
function match(q: string, ...values: unknown[]): boolean { return values.some((value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase(currentLanguageTag()).includes(q)); }
function compareContainers(a: Container, b: Container): number { const rank = (s: string) => s === 'running' ? 0 : s === 'paused' ? 1 : 2; return rank(a.state) - rank(b.state) || (a.name || a.container_id).localeCompare(b.name || b.container_id); }
function containerComparator(sort: SortKey): (a: Container, b: Container) => number { if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0); if (sort === 'usage') return (a, b) => (state.containerStats.get(b.container_id)?.cpu_percent ?? -1) - (state.containerStats.get(a.container_id)?.cpu_percent ?? -1); if (sort === 'state') return compareContainers; return (a, b) => (a.name || a.container_id).localeCompare(b.name || b.container_id); }
function imageComparator(sort: SortKey): (a: Image, b: Image) => number { if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0); if (sort === 'size') return (a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0); if (sort === 'usage') return (a, b) => b.referenced_containers - a.referenced_containers; return (a, b) => imageName(a).localeCompare(imageName(b)); }
function volumeComparator(sort: SortKey): (a: Volume, b: Volume) => number { if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0); if (sort === 'usage') return (a, b) => b.referenced_containers - a.referenced_containers; return (a, b) => a.name.localeCompare(b.name); }
function imageName(image: Image): string { return image.reference || image.tags?.[0] || image.digest || image.id; }
function splitValue(value?: string): [string, string] { const index = value?.indexOf('|') ?? -1; return index < 0 ? ['', ''] : [value!.slice(0, index), value!.slice(index + 1)]; }
function clean(value?: string): string { return value?.trim() ?? ''; }
function lines(value?: string): string[] | undefined { const result = (value ?? '').split(/\r?\n/u).map(clean).filter(Boolean); return result.length ? result : undefined; }
function tokens(value?: string): string[] | undefined { const result = (value ?? '').split(/[\s,]+/u).map(clean).filter(Boolean); return result.length ? result : undefined; }
function optionalNumber(value?: string): number | undefined { const input = clean(value); if (!input) return undefined; const parsed = Number(input); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('invalid number'); return parsed; }
function optionalInteger(value?: string): number | undefined { const parsed = optionalNumber(value); if (parsed === undefined) return undefined; if (!Number.isInteger(parsed) || parsed < 4) throw new Error('invalid integer'); return parsed; }
function parseCommandRows(data: Record<string, string>): string[] | undefined { const values = rowValues('command', (id) => clean(data[`command_${id}`])).filter(Boolean); return values.length ? values : undefined; }
function parseEnvironmentRows(data: Record<string, string>): string[] | undefined { const values = rowValues('env', (id) => { const key = clean(data[`env_key_${id}`]); const value = data[`env_value_${id}`] ?? ''; if (!key && !value) return undefined; if (!key || key.includes('=')) throw new Error('invalid environment variable'); return `${key}=${value}`; }).filter(present); return values.length ? values : undefined; }
function parsePortRows(data: Record<string, string>): CreateRequest['ports'] { const values = rowValues('ports', (id) => { const hostIP = clean(data[`ports_host_ip_${id}`]); const hostPortValue = clean(data[`ports_host_port_${id}`]); const containerPortValue = clean(data[`ports_container_port_${id}`]); const protocol = clean(data[`ports_protocol_${id}`] || 'tcp').toLowerCase(); if (!hostIP && !hostPortValue && !containerPortValue) return undefined; const hostPort = hostPortValue ? Number(hostPortValue) : undefined; const containerPort = Number(containerPortValue); if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535 || (hostPort !== undefined && (!Number.isInteger(hostPort) || hostPort < 0 || hostPort > 65535)) || !['tcp', 'udp', 'sctp'].includes(protocol)) throw new Error('invalid port'); return { container_port: containerPort, host_port: hostPort, host_ip: hostIP || undefined, protocol: protocol as 'tcp' | 'udp' | 'sctp' }; }).filter(present); return values.length ? values : undefined; }
function parseMountRows(data: Record<string, string>): CreateRequest['mounts'] { const values = rowValues('mounts', (id) => { const typeValue = clean(data[`mounts_type_${id}`] || 'volume'); const source = clean(data[`mounts_source_${id}`]); const target = clean(data[`mounts_target_${id}`]); if (!source && !target) return undefined; if (!['bind', 'volume', 'tmpfs'].includes(typeValue) || !target || (typeValue !== 'tmpfs' && !source)) throw new Error('invalid mount'); return { type: typeValue as 'bind' | 'volume' | 'tmpfs', source: source || undefined, target, read_only: data[`mounts_readonly_${id}`] === 'on' }; }).filter(present); return values.length ? values : undefined; }
function parseDeviceRows(data: Record<string, string>): CreateRequest['devices'] { const values = rowValues('devices', (id) => { const hostPath = clean(data[`devices_host_${id}`]); const containerPath = clean(data[`devices_container_${id}`]); const permissions = clean(data[`devices_permissions_${id}`] || 'rwm'); if (!hostPath && !containerPath) return undefined; if (!hostPath || !/^(?!.*(.).*\1)[rwm]{1,3}$/u.test(permissions)) throw new Error('invalid device'); return { host_path: hostPath, container_path: containerPath || undefined, permissions }; }).filter(present); return values.length ? values : undefined; }
function parseOptionRows(data: Record<string, string>): Array<{ key: string; value: string }> | undefined { const seen = new Set<string>(); const values = rowValues('volume-options', (id) => { const key = clean(data[`volume_options_key_${id}`]); const value = data[`volume_options_value_${id}`] ?? ''; if (!key && !value) return undefined; if (!key || seen.has(key)) throw new Error('invalid option'); seen.add(key); return { key, value }; }).filter(present); return values.length ? values : undefined; }
function rowValues<T>(kind: FormRowKind, project: (id: number) => T): T[] { return state.formRows[kind].map(project); }
function present<T>(value: T | undefined): value is T { return value !== undefined; }
function initialFormRows(): Record<FormRowKind, number[]> { return { command: [1], env: [1], ports: [1], mounts: [1], devices: [1], 'volume-options': [1] }; }
function resetFormRows(): void { state.formRows = initialFormRows(); state.nextFormRowID = 2; }
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function short(value: string): string { return value.length > 16 ? value.slice(0, 12) : value; }
function formatBytes(value?: number): string { if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1); return `${new Intl.NumberFormat(currentLanguageTag(), { maximumFractionDigits: 1 }).format(value / (1000 ** index))} ${units[index]}`; }
function formatDate(value?: number): string { return value ? new Intl.DateTimeFormat(currentLanguageTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(value) : c('unknown'); }
function hash(value: string): string { let out = 0; for (let i = 0; i < value.length; i += 1) out = ((out << 5) - out + value.charCodeAt(i)) | 0; return Math.abs(out).toString(36); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function allSettledWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next; next += 1;
      try { results[index] = { status: 'fulfilled', value: await worker(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}
function readableError(error: unknown, fallback: Message): Message { if (isRedevenContainerResourcesV3BusinessError(error)) { const code = error.details.business_error_code; if (code === 'CONTAINER_CLI_UNAVAILABLE') return msg('engineCliMissing', { engine: title(state.engine) }); if (code === 'CONTAINER_DAEMON_STOPPED') return msg('daemonStopped', { engine: title(state.engine) }); if (code === 'CONTAINER_ENGINE_UNREACHABLE') return msg('engineUnreachable', { engine: title(state.engine) }); if (code === 'CONTAINER_PERMISSION_DENIED') return msg('permissionDenied', { engine: title(state.engine) }); if (code === 'CONTAINER_OPERATION_TIMEOUT') return msg('operationTimedOut', { engine: title(state.engine) }); if (code === 'CONTAINER_REFERENCE_STATE_INCOMPLETE') return msg('referenceStateIncomplete'); if (code === 'CONTAINER_ENGINE_UNAVAILABLE') return msg('unavailableSentence', { engine: title(state.engine) }); if (code === 'CONTAINER_NOT_FOUND') return msg('containerMissing'); if (code === 'CONTAINER_RUNNING') return msg('containerRunning'); if (code === 'CONTAINER_IMAGE_NOT_FOUND') return msg('imageMissing'); if (code === 'CONTAINER_IMAGE_IN_USE') return msg('imageInUse'); if (code === 'CONTAINER_VOLUME_IN_USE') return msg('volumeInUse'); if (code === 'CONTAINER_PLAN_STALE') return msg('planStale'); if (code === 'CONTAINER_RESOURCE_UNSUPPORTED') return msg('unsupportedOperation'); } return fallback; }
function currentLanguageTag(): string { return state.context?.locale.language_tag ?? 'en-US'; }
function currentLocale() { return resolveContainersLocale(currentLanguageTag()); }
function c(key: CopyKey, params?: CopyParams): string { return containersCopy(currentLocale(), key, params); }
function msg(key: CopyKey, params?: Record<string, string | number | Message>): Message { return { key, params }; }
function literal(value: string): Message { return { literal: value }; }
function messageText(message: Message): string {
  if ('literal' in message) return message.literal;
  const params: CopyParams = {};
  for (const [name, value] of Object.entries(message.params ?? {})) params[name] = typeof value === 'object' ? messageText(value) : value;
  return c(message.key, params);
}
function isMessageKey(message: Message, key: CopyKey): boolean { return 'key' in message && message.key === key; }
function viewLabel(view: View): string { return c(view === 'containers' ? 'viewContainers' : view === 'images' ? 'viewImages' : 'viewVolumes'); }
function viewMessage(view: View): Message { return msg(view === 'containers' ? 'viewContainers' : view === 'images' ? 'viewImages' : 'viewVolumes'); }
function searchLabel(view: View): string { return c(view === 'containers' ? 'searchContainers' : view === 'images' ? 'searchImages' : 'searchVolumes'); }
function directActionMessage(method: DirectMethod): Message { return msg(method === 'stop' ? 'stop' : method === 'restart' ? 'restart' : method === 'pause' ? 'pause' : method === 'unpause' ? 'resume' : method === 'kill' ? 'kill' : 'remove'); }
function riskLabel(risk?: string): string { return c(risk === 'low' ? 'lowRisk' : risk === 'medium' ? 'mediumRisk' : risk === 'high' ? 'highRisk' : risk === 'critical' ? 'criticalRisk' : 'reviewRisk'); }
function localizeStatus(status: string): string { const normalized = status.toLowerCase().replaceAll(' ', '_'); if (normalized === 'running') return c('running'); if (normalized === 'paused') return c('paused'); if (normalized === 'stopped' || normalized === 'exited' || normalized === 'dead') return c('stopped'); return status; }
function localizeHealth(health?: string): string { return c(health === 'healthy' ? 'healthHealthy' : health === 'unhealthy' ? 'healthUnhealthy' : health === 'starting' ? 'healthStarting' : 'healthUnknown'); }
function statusMessage(status: string): Message { const normalized = status.toLowerCase().replaceAll(' ', '_'); if (normalized === 'running') return msg('running'); if (normalized === 'completed') return msg('statusCompleted'); if (normalized === 'failed') return msg('statusFailed'); if (normalized === 'canceled' || normalized === 'cancelled') return msg('statusCanceled'); if (normalized === 'cancel_requested') return msg('statusCancelRequested'); return literal(status); }
function progressPhaseMessage(phase: string): Message { const normalized = phase.toLowerCase().replaceAll(' ', '_'); if (normalized === 'running') return msg('progressRunning'); if (normalized === 'finalizing') return msg('progressFinalizing'); return literal(phase); }

const PLAN_SUMMARY_KEYS: Partial<Record<string, CopyKey>> = {
  'containers.create': 'summaryContainersCreate',
  'containers.start': 'summaryContainersStart',
  'containers.remove': 'summaryContainersRemove',
  'images.remove': 'summaryImagesRemove',
  'images.prune': 'summaryImagesPrune',
  'volumes.create': 'summaryVolumesCreate',
  'volumes.remove': 'summaryVolumesRemove',
  'volumes.prune': 'summaryVolumesPrune',
};

function planSummaryMessages(dialog: Extract<Dialog, { kind: 'plan' }>): Message[] {
  if (dialog.summary) return dialog.summary;
  const key = PLAN_SUMMARY_KEYS[dialog.plan.method];
  if (key) {
    const target = dialog.plan.target as {
      resource_count?: number;
      reclaimable_bytes?: number;
    } | undefined;
    const messages: Message[] = [msg(key)];
    if (target?.resource_count !== undefined) messages.push(msg('exactResourceCount', { count: target.resource_count }));
    if (target?.reclaimable_bytes) messages.push(msg('reclaimableSpace', { size: formatBytes(target.reclaimable_bytes) }));
    return messages;
  }
  return (dialog.plan.summary ?? []).map(literal);
}

function resourceIdentities(plan: Plan): string[] {
  const value = (plan.request as { resource_identities?: unknown } | undefined)?.resource_identities
    ?? (plan.target as { resource_identities?: unknown } | undefined)?.resource_identities;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function canConfirmPlan(dialog: Extract<Dialog, { kind: 'plan' }>): boolean {
  if (dialog.busy) return false;
  if (dialog.intent.kind === 'direct') return true;
  if (!dialog.plan.plan_digest) return false;
  if (dialog.intent.kind === 'prune-images' || dialog.intent.kind === 'prune-volumes') return resourceIdentities(dialog.plan).length > 0;
  return true;
}

const RISK_FLAG_KEYS: Record<string, { title: CopyKey; detail: CopyKey }> = {
  container_privileged: { title: 'riskContainerPrivilegedTitle', detail: 'riskContainerPrivilegedDetail' },
  host_network: { title: 'riskHostNetworkTitle', detail: 'riskHostNetworkDetail' },
  host_pid_namespace: { title: 'riskHostPidTitle', detail: 'riskHostPidDetail' },
  host_ipc_namespace: { title: 'riskHostIpcTitle', detail: 'riskHostIpcDetail' },
  host_device: { title: 'riskHostDeviceTitle', detail: 'riskHostDeviceDetail' },
  added_linux_capability: { title: 'riskAddedCapabilityTitle', detail: 'riskAddedCapabilityDetail' },
  container_socket_mount: { title: 'riskSocketMountTitle', detail: 'riskSocketMountDetail' },
  host_bind_mount: { title: 'riskBindMountTitle', detail: 'riskBindMountDetail' },
  sensitive_mount_path: { title: 'riskSensitiveMountTitle', detail: 'riskSensitiveMountDetail' },
  secret_environment: { title: 'riskSecretEnvironmentTitle', detail: 'riskSecretEnvironmentDetail' },
  secret_labels: { title: 'riskSecretLabelsTitle', detail: 'riskSecretLabelsDetail' },
  persistent_restart_policy: { title: 'riskPersistentRestartTitle', detail: 'riskPersistentRestartDetail' },
  image_not_digest_pinned: { title: 'riskImageUnpinnedTitle', detail: 'riskImageUnpinnedDetail' },
};

function riskFlagMessages(flag: NonNullable<Plan['risk_flags']>[number]): { title: Message; detail?: Message } {
  const known = RISK_FLAG_KEYS[flag.id];
  if (known) return { title: msg(known.title), detail: msg(known.detail) };
  return { title: literal(flag.title || flag.id), detail: flag.detail ? literal(flag.detail) : undefined };
}
async function renderSafely(): Promise<void> { try { await render(); } catch { /* The next authoritative update retries projection. */ } }
