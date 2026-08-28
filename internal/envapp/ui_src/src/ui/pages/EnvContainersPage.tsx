import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Info,
  Layers,
  Package,
  Pause,
  Play,
  Plus,
  Refresh,
  Search,
  Stop,
  Trash,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tag } from '@floegence/floe-webapp-core/ui';

import { Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import {
  cancelContainerOperation,
  createContainerOperation,
  getContainerEndpointStatus,
  getContainerResourceDetails,
  getContainerStats,
  listContainerEndpoints,
  listContainerOperations,
  listContainerResources,
  preflightContainerOperation,
  subscribeContainerOperation,
  tailContainerLogs,
  type ComposeProjectInventoryItem,
  type ContainerEndpoint,
  type ContainerEngine,
  type ContainerInventoryItem,
  type ContainerLogLine,
  type ContainerOperation,
  type ContainerPreflight,
  type ContainerResourceInventoryItem,
  type ContainerResourceView,
  type ContainerStats,
  type ImageInventoryItem,
  type PodInventoryItem,
  type VolumeInventoryItem,
} from '../services/containerResourcesApi';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { useI18n } from '../i18n';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { useEnvContext } from './EnvContext';
import './env-containers.css';

type PersistedContainersState = Readonly<{
  version: 1;
  engine: ContainerEngine;
  endpointID: string;
  view: ContainerResourceView;
  selectedIdentity: string;
}>;

type CreationMode = 'container' | 'image' | 'volume' | 'pod' | 'image-tag';

type MutationDraft = Readonly<{
  method: string;
  request: Record<string, unknown>;
  confirmationLabel?: string;
  confirmationValue?: string;
}>;

type ReviewState = Readonly<{
  request: Record<string, unknown>;
  preflight: ContainerPreflight;
}>;

type ResourceFilter = 'all' | 'active' | 'inactive' | 'managed';

type DetailRecord = Readonly<Record<string, unknown>>;

const DEFAULT_STATE: PersistedContainersState = {
  version: 1,
  engine: 'docker',
  endpointID: '',
  view: 'containers',
  selectedIdentity: '',
};

const TERMINAL_OPERATION_STATES = new Set(['succeeded', 'failed', 'canceled', 'interrupted']);
const LOCALIZED_RESOURCE_STATES = new Set([
  'running', 'stopped', 'exited', 'paused', 'restarting', 'created', 'removing',
  'dead', 'healthy', 'unhealthy', 'degraded', 'partial', 'unknown',
]);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isDetailRecord(value: unknown): value is DetailRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function detailRecord(value: unknown): DetailRecord {
  return isDetailRecord(value) ? value : {};
}

function detailString(record: DetailRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? compact(value) : '';
}

function detailNumber(record: DetailRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function detailBoolean(record: DetailRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function detailArray(record: DetailRecord, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function sanitizePersistedState(value: unknown): PersistedContainersState {
  const candidate = value as Partial<PersistedContainersState> | null;
  const engine = candidate?.engine === 'podman' ? 'podman' : 'docker';
  const availableViews: readonly ContainerResourceView[] = engine === 'podman'
    ? ['containers', 'images', 'volumes', 'pods']
    : ['containers', 'images', 'volumes', 'compose-projects'];
  const view = availableViews.includes(candidate?.view as ContainerResourceView)
    ? candidate?.view as ContainerResourceView
    : 'containers';
  return {
    version: 1,
    engine,
    endpointID: compact(candidate?.endpointID),
    view,
    selectedIdentity: compact(candidate?.selectedIdentity),
  };
}

function resourceIdentity(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).container_id);
    case 'images': {
      const image = item as ImageInventoryItem;
      return compact(image.reference || image.tags?.[0] || image.digest || image.id);
    }
    case 'volumes': return compact((item as VolumeInventoryItem).name);
    case 'compose-projects': return compact((item as ComposeProjectInventoryItem).project_id);
    case 'pods': return compact((item as PodInventoryItem).pod_id);
  }
}

function resourceName(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).name) || resourceIdentity(view, item).slice(0, 12);
    case 'images': {
      const image = item as ImageInventoryItem;
      return compact(image.reference || image.tags?.[0] || image.digest || image.id);
    }
    case 'volumes': return (item as VolumeInventoryItem).name;
    case 'compose-projects': return (item as ComposeProjectInventoryItem).name;
    case 'pods': return (item as PodInventoryItem).name;
  }
}

function resourceStatus(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).state);
    case 'images': return `${(item as ImageInventoryItem).referenced_containers}`;
    case 'volumes': return `${(item as VolumeInventoryItem).referenced_containers}`;
    case 'compose-projects': return compact((item as ComposeProjectInventoryItem).status);
    case 'pods': return compact((item as PodInventoryItem).status);
  }
}

function resourceActive(view: ContainerResourceView, item: ContainerResourceInventoryItem): boolean {
  if (view === 'images' || view === 'volumes') {
    return Number(resourceStatus(view, item)) > 0;
  }
  return ['running', 'restarting', 'up', 'healthy', 'partial'].includes(resourceStatus(view, item).toLowerCase());
}

function resourceSearchText(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  const values = [resourceName(view, item), resourceIdentity(view, item), resourceStatus(view, item)];
  if (view === 'containers') {
    const container = item as ContainerInventoryItem;
    values.push(container.image?.reference ?? '', container.health ?? '', container.group_name ?? '');
  } else if (view === 'images') {
    const image = item as ImageInventoryItem;
    values.push(image.reference ?? '', image.digest ?? '', ...(image.tags ?? []));
  } else if (view === 'volumes') {
    const volume = item as VolumeInventoryItem;
    values.push(volume.driver ?? '', volume.scope ?? '');
  } else if (view === 'compose-projects') {
    values.push((item as ComposeProjectInventoryItem).name);
  } else {
    values.push((item as PodInventoryItem).infra_id ?? '');
  }
  return values.join('\n').toLocaleLowerCase();
}

function resourceStatusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  const normalized = status.toLowerCase();
  if (['running', 'healthy', 'up'].includes(normalized)) return 'success';
  if (['restarting', 'paused', 'partial', 'degraded', 'created'].includes(normalized)) return 'warning';
  if (['dead', 'unhealthy', 'failed'].includes(normalized)) return 'error';
  return 'neutral';
}

function resourceManagement(item: ContainerResourceInventoryItem | null) {
  if (!item) return undefined;
  return (item as ContainerInventoryItem | VolumeInventoryItem | ComposeProjectInventoryItem).management;
}

function formatBytes(value: number | undefined): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function operationActive(operation: ContainerOperation): boolean {
  return !TERMINAL_OPERATION_STATES.has(operation.state);
}

function ViewIcon(props: { view: ContainerResourceView; class?: string }) {
  const className = props.class ?? 'h-4 w-4';
  if (props.view === 'images') return <Package class={className} aria-hidden="true" />;
  if (props.view === 'volumes') return <Database class={className} aria-hidden="true" />;
  if (props.view === 'compose-projects') return <FileText class={className} aria-hidden="true" />;
  if (props.view === 'pods') return <Activity class={className} aria-hidden="true" />;
  return <Layers class={className} aria-hidden="true" />;
}

function DetailSection(props: { title: string; icon: JSX.Element; children: JSX.Element }) {
  return (
    <section class="container-detail-section">
      <h3 class="container-detail-section__title"><span aria-hidden="true">{props.icon}</span>{props.title}</h3>
      <div class="container-detail-section__body">{props.children}</div>
    </section>
  );
}

function DetailRow(props: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div class="container-detail-row">
      <dt>{props.label}</dt>
      <dd class={props.mono ? 'font-mono' : undefined} title={String(props.value)}>{props.value}</dd>
    </div>
  );
}

export function EnvContainersPage(props: { stateScope?: string; variant?: 'activity' | 'workbench' }) {
  const i18n = useI18n();
  const notify = useNotification();
  const env = useEnvContext();
  const storageKey = () => `containers:${compact(props.stateScope) || 'activity'}`;
  const restored = sanitizePersistedState(readUIStorageJSON(storageKey(), DEFAULT_STATE));
  const [engine, setEngine] = createSignal<ContainerEngine>(restored.engine);
  const [endpointID, setEndpointID] = createSignal(restored.endpointID);
  const [view, setView] = createSignal<ContainerResourceView>(restored.view);
  const [selectedIdentity, setSelectedIdentity] = createSignal(restored.selectedIdentity);
  const [endpoints, setEndpoints] = createSignal<ContainerEndpoint[]>([]);
  const [endpointStatus, setEndpointStatus] = createSignal<ContainerEndpoint | null>(null);
  const [inventory, setInventory] = createSignal<ContainerResourceInventoryItem[]>([]);
  const [details, setDetails] = createSignal<unknown>(null);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [resourceFilter, setResourceFilter] = createSignal<ResourceFilter>('all');
  const [loading, setLoading] = createSignal(true);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal('');
  const [operations, setOperations] = createSignal<ContainerOperation[]>([]);
  const [operationsOpen, setOperationsOpen] = createSignal(false);
  const [creationMode, setCreationMode] = createSignal<CreationMode | null>(null);
  const [creationName, setCreationName] = createSignal('');
  const [creationImage, setCreationImage] = createSignal('');
  const [creationDriver, setCreationDriver] = createSignal('local');
  const [creationCommand, setCreationCommand] = createSignal('');
  const [creationRestart, setCreationRestart] = createSignal('no');
  const [creationCPUs, setCreationCPUs] = createSignal('');
  const [creationMemory, setCreationMemory] = createSignal('');
  const [pendingConfirmation, setPendingConfirmation] = createSignal<MutationDraft | null>(null);
  const [confirmation, setConfirmation] = createSignal('');
  const [review, setReview] = createSignal<ReviewState | null>(null);
  const [mutationBusy, setMutationBusy] = createSignal(false);
  const [logs, setLogs] = createSignal<ContainerLogLine[] | null>(null);
  const [stats, setStats] = createSignal<ContainerStats | null>(null);
  const [inspectorMode, setInspectorMode] = createSignal<'details' | 'logs' | 'stats'>('details');
  let endpointLoadSequence = 0;
  let inventoryLoadSequence = 0;
  let operationStreamAbort: AbortController | null = null;

  const permissions = createMemo(() => env.env()?.permissions);
  const canRead = createMemo(() => Boolean(permissions()?.can_read));
  const canExecute = createMemo(() => canRead() && Boolean(permissions()?.can_execute));
  const canRWX = createMemo(() => canExecute() && Boolean(permissions()?.can_write));
  const canAdmin = createMemo(() => Boolean(permissions()?.can_admin || permissions()?.is_owner));
  const availableViews = createMemo<readonly ContainerResourceView[]>(() => engine() === 'podman'
    ? ['containers', 'images', 'volumes', 'pods']
    : ['containers', 'images', 'volumes', 'compose-projects']);
  const selected = createMemo(() => {
    const identity = selectedIdentity();
    if (!identity) return null;
    return inventory().find((item) => resourceIdentity(view(), item) === identity) ?? null;
  });
  const selectedManagedOwner = createMemo(() => resourceManagement(selected())?.owner ?? null);
  const activeOperationCount = createMemo(() => operations().filter(operationActive).length);
  const activeResourceCount = createMemo(() => inventory().filter((item) => resourceActive(view(), item)).length);
  const inactiveResourceCount = createMemo(() => Math.max(0, inventory().length - activeResourceCount()));
  const activeResourceShare = createMemo(() => inventory().length > 0
    ? Math.round((activeResourceCount() / inventory().length) * 100)
    : 0);
  const managedResourceCount = createMemo(() => inventory().filter((item) => resourceManagement(item)?.managed).length);
  const filteredInventory = createMemo(() => {
    const query = searchQuery().trim().toLocaleLowerCase();
    const filter = resourceFilter();
    return inventory().filter((item) => {
      if (query && !resourceSearchText(view(), item).includes(query)) return false;
      if (filter === 'active' && !resourceActive(view(), item)) return false;
      if (filter === 'inactive' && resourceActive(view(), item)) return false;
      if (filter === 'managed' && !resourceManagement(item)?.managed) return false;
      return true;
    });
  });
  const selectedDetailRecord = createMemo(() => {
    const loaded = detailRecord(details());
    return Object.keys(loaded).length > 0 ? loaded : detailRecord(selected());
  });

  createEffect(() => {
    writeUIStorageJSON(storageKey(), {
      version: 1,
      engine: engine(),
      endpointID: endpointID(),
      view: view(),
      selectedIdentity: selectedIdentity(),
    } satisfies PersistedContainersState);
  });

  const loadOperations = async () => {
    if (!canRead()) return;
    try {
      setOperations(await listContainerOperations());
    } catch {
      // Inventory remains usable when operation history is temporarily unavailable.
    }
  };

  const loadEndpointInventory = async () => {
    const sequence = ++endpointLoadSequence;
    setLoading(true);
    setError('');
    try {
      const nextEndpoints = await listContainerEndpoints(engine());
      if (sequence !== endpointLoadSequence) return;
      setEndpoints(nextEndpoints);
      const current = nextEndpoints.find((item) => item.endpoint_id === endpointID());
      const nextEndpoint = current ?? nextEndpoints.find((item) => item.default) ?? nextEndpoints[0];
      setEndpointID(nextEndpoint?.endpoint_id ?? '');
      setEndpointStatus(nextEndpoint ?? null);
      if (nextEndpoint?.endpoint_id) {
        getContainerEndpointStatus(engine(), nextEndpoint.endpoint_id)
          .then((status) => sequence === endpointLoadSequence && setEndpointStatus(status))
          .catch(() => undefined);
      }
    } catch (cause) {
      if (sequence !== endpointLoadSequence) return;
      setEndpoints([]);
      setEndpointStatus(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === endpointLoadSequence) setLoading(false);
    }
  };

  const loadInventory = async (quiet = false) => {
    if (!canRead()) {
      setInventory([]);
      setError(i18n.t('containers.permissions.read'));
      return;
    }
    const sequence = ++inventoryLoadSequence;
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const items = await listContainerResources(view(), engine(), endpointID());
      if (sequence !== inventoryLoadSequence) return;
      setInventory(items);
      const currentIdentity = selectedIdentity();
      if (currentIdentity && !items.some((item) => resourceIdentity(view(), item) === currentIdentity)) {
        setSelectedIdentity('');
        setDetails(null);
        setLogs(null);
        setStats(null);
        notify.info(i18n.t('containers.notifications.inventoryChangedTitle'), i18n.t('containers.notifications.inventoryChangedMessage'));
      }
    } catch (cause) {
      if (sequence !== inventoryLoadSequence) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === inventoryLoadSequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  createEffect(() => {
    engine();
    void loadEndpointInventory().then(loadOperations);
  });

  createEffect(() => {
    endpointID();
    view();
    void loadInventory();
  });

  createEffect(() => {
    const identity = selectedIdentity();
    const currentView = view();
    if (!identity) {
      setDetails(null);
      return;
    }
    getContainerResourceDetails(currentView, identity, engine(), endpointID())
      .then(setDetails)
      .catch(() => setDetails(null));
  });

  createEffect(() => {
    if (!operations().some(operationActive)) return;
    const timer = window.setInterval(() => void loadOperations(), 1200);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (inspectorMode() !== 'stats' || view() !== 'containers' || !selectedIdentity()) return;
    const refresh = () => getContainerStats(selectedIdentity(), engine(), endpointID()).then(setStats).catch(() => setStats(null));
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  onMount(() => void loadOperations());
  onCleanup(() => operationStreamAbort?.abort());

  const setCurrentEngine = (next: ContainerEngine) => {
    setEngine(next);
    setEndpointID('');
    setSelectedIdentity('');
    setDetails(null);
    setSearchQuery('');
    setResourceFilter('all');
    if (next === 'podman' && view() === 'compose-projects') setView('pods');
    if (next === 'docker' && view() === 'pods') setView('compose-projects');
  };

  const selectResource = (item: ContainerResourceInventoryItem) => {
    setSelectedIdentity(resourceIdentity(view(), item));
    setInspectorMode('details');
    setLogs(null);
    setStats(null);
  };

  const viewLabel = (value: ContainerResourceView): string => i18n.t(`containers.views.${value}` as Parameters<typeof i18n.t>[0]);

  const localizedResourceStatus = (value: string): string => {
    const safeValue = compact(value);
    const normalized = safeValue.toLowerCase() || 'unknown';
    if (!LOCALIZED_RESOURCE_STATES.has(normalized)) return safeValue || i18n.t('containers.states.unknown');
    return i18n.t(`containers.states.${normalized}` as Parameters<typeof i18n.t>[0]);
  };

  const formatDate = (value: number | undefined): string => {
    if (!value) return '—';
    try {
      return i18n.formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return String(value);
    }
  };

  const filterLabel = (value: ResourceFilter): string => {
    if ((view() === 'images' || view() === 'volumes') && value === 'active') return i18n.t('containers.filters.inUse');
    if ((view() === 'images' || view() === 'volumes') && value === 'inactive') return i18n.t('containers.filters.unused');
    return i18n.t(`containers.filters.${value}` as Parameters<typeof i18n.t>[0]);
  };

  const secondaryColumnLabel = () => {
    if (view() === 'containers') return i18n.t('containers.columns.image');
    if (view() === 'images') return i18n.t('containers.columns.size');
    if (view() === 'volumes') return i18n.t('containers.columns.driver');
    return i18n.t('containers.columns.running');
  };

  const tertiaryColumnLabel = () => (view() === 'images' || view() === 'volumes')
    ? i18n.t('containers.columns.usage')
    : i18n.t('containers.columns.status');

  const renderStatus = (status: string) => (
    <span class="container-status" data-tone={resourceStatusTone(status)}>
      <span class="container-status__dot" aria-hidden="true" />
      {localizedResourceStatus(status)}
    </span>
  );

  const formatPort = (value: unknown): string => {
    const port = detailRecord(value);
    const containerPort = detailNumber(port, 'port');
    const hostPort = detailNumber(port, 'host_port');
    const hostIP = detailString(port, 'host_ip');
    const protocol = detailString(port, 'protocol');
    const target = containerPort ? `${containerPort}${protocol ? `/${protocol}` : ''}` : '';
    if (hostPort) return `${hostIP ? `${hostIP}:` : ''}${hostPort}${target ? ` → ${target}` : ''}`;
    return target;
  };

  const operationLabel = (method: string): string => {
    const labels: Readonly<Record<string, Parameters<typeof i18n.t>[0]>> = {
      'containers.create': 'containers.create.container',
      'images.pull': 'containers.create.image',
      'volumes.create': 'containers.create.volume',
      'pods.create': 'containers.create.pod',
      'images.tag': 'containers.actions.tag',
      'images.prune': 'containers.actions.prune',
      'volumes.prune': 'containers.actions.prune',
      'containers.start': 'containers.actions.start',
      'containers.stop': 'containers.actions.stop',
      'containers.restart': 'containers.actions.restart',
      'containers.pause': 'containers.actions.pause',
      'containers.unpause': 'containers.actions.resume',
      'containers.kill': 'containers.actions.kill',
      'containers.remove': 'containers.actions.remove',
      'images.remove': 'containers.actions.remove',
      'volumes.remove': 'containers.actions.remove',
      'compose.projects.start': 'containers.actions.start',
      'compose.projects.stop': 'containers.actions.stop',
      'compose.projects.restart': 'containers.actions.restart',
      'compose.projects.down': 'containers.actions.down',
      'pods.start': 'containers.actions.start',
      'pods.stop': 'containers.actions.stop',
      'pods.restart': 'containers.actions.restart',
      'pods.remove': 'containers.actions.remove',
    };
    const key = labels[method];
    return key ? i18n.t(key) : method;
  };

  const operationStateLabel = (state: ContainerOperation['state']): string => (
    i18n.t(`containers.operationStates.${state}` as Parameters<typeof i18n.t>[0])
  );

  const beginPreflight = async (draft: MutationDraft) => {
    setMutationBusy(true);
    try {
      const preflight = await preflightContainerOperation(draft.method, draft.request);
      setReview({ request: draft.request, preflight });
      setPendingConfirmation(null);
      setConfirmation('');
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.preflightFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const beginMutation = (draft: MutationDraft) => {
    if (draft.confirmationValue) {
      setConfirmation('');
      setPendingConfirmation(draft);
      return;
    }
    void beginPreflight(draft);
  };

  const submitConfirmation = () => {
    const pending = pendingConfirmation();
    if (!pending || confirmation() !== pending.confirmationValue) return;
    const request = { ...pending.request, confirmation_name: confirmation() };
    void beginPreflight({ ...pending, request });
  };

  const runReviewedOperation = async () => {
    const current = review();
    if (!current || (current.preflight.plan.requires_admin && !canAdmin())) return;
    setMutationBusy(true);
    try {
      const operation = await createContainerOperation(current.preflight, current.request);
      setReview(null);
      setOperationsOpen(true);
      setOperations((previous) => [operation, ...previous.filter((item) => item.operation_id !== operation.operation_id)]);
      operationStreamAbort?.abort();
      const controller = new AbortController();
      operationStreamAbort = controller;
      void subscribeContainerOperation(operation.operation_id, (next) => {
        setOperations((previous) => [next, ...previous.filter((item) => item.operation_id !== next.operation_id)]);
        if (TERMINAL_OPERATION_STATES.has(next.state)) {
          void loadInventory(true);
          if (next.state === 'succeeded') {
            notify.success(i18n.t('containers.notifications.operationCompleteTitle'), i18n.t('containers.notifications.operationCompleteMessage'));
          }
        }
      }, controller.signal).catch(() => loadOperations());
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.operationFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const actionRequest = (method: string): MutationDraft | null => {
    const item = selected();
    if (!item) return null;
    const base = { engine: engine(), endpoint_id: endpointID() };
    if (view() === 'containers') {
      const container = item as ContainerInventoryItem;
      const name = resourceName('containers', container);
      const force = method === 'containers.remove' && ['running', 'paused', 'restarting'].includes(container.state);
      return {
        method,
        request: { ...base, container_id: container.container_id, ...(force ? { force: true } : {}) },
        ...(method === 'containers.remove' || method === 'containers.kill'
          ? { confirmationLabel: name, confirmationValue: name }
          : {}),
      };
    }
    if (view() === 'images') {
      const image = item as ImageInventoryItem;
      const identity = resourceIdentity('images', image);
      return {
        method,
        request: { ...base, image: identity, ...(image.referenced_containers > 0 ? { force: true } : {}) },
        confirmationLabel: identity,
        confirmationValue: identity,
      };
    }
    if (view() === 'volumes') {
      const volume = item as VolumeInventoryItem;
      return { method, request: { ...base, name: volume.name }, confirmationLabel: volume.name, confirmationValue: volume.name };
    }
    if (view() === 'compose-projects') {
      const project = item as ComposeProjectInventoryItem;
      return {
        method,
        request: { ...base, project_id: project.project_id },
        ...(method === 'compose.projects.down' ? { confirmationLabel: project.name, confirmationValue: project.name } : {}),
      };
    }
    const pod = item as PodInventoryItem;
    return {
      method,
      request: { ...base, pod_id: pod.pod_id },
      ...(method === 'pods.remove' ? { confirmationLabel: pod.name, confirmationValue: pod.name } : {}),
    };
  };

  const runAction = (method: string) => {
    const request = actionRequest(method);
    if (request) beginMutation(request);
  };

  const prune = () => {
    const identities = inventory().filter((item) => {
      if (view() === 'images') return (item as ImageInventoryItem).referenced_containers === 0;
      if (view() === 'volumes') return (item as VolumeInventoryItem).referenced_containers === 0 && !resourceManagement(item)?.managed;
      return false;
    }).map((item) => resourceIdentity(view(), item));
    if (identities.length === 0) return;
    beginMutation({
      method: view() === 'images' ? 'images.prune' : 'volumes.prune',
      request: { engine: engine(), endpoint_id: endpointID(), resource_identities: identities },
    });
  };

  const submitCreation = () => {
    const mode = creationMode();
    const base = { engine: engine(), endpoint_id: endpointID() };
    let draft: MutationDraft | null = null;
    if (mode === 'container') {
      const memoryMiB = Number(creationMemory());
      const cpus = Number(creationCPUs());
      draft = {
        method: 'containers.create',
        request: {
          ...base,
          name: compact(creationName()),
          image: compact(creationImage()),
          ...(compact(creationCommand()) ? { command: [compact(creationCommand())] } : {}),
          ...(creationRestart() !== 'no' ? { restart_policy: creationRestart() } : {}),
          ...(Number.isFinite(cpus) && cpus > 0 ? { cpu_count: cpus } : {}),
          ...(Number.isFinite(memoryMiB) && memoryMiB > 0 ? { memory_bytes: Math.round(memoryMiB * 1024 * 1024) } : {}),
        },
      };
    } else if (mode === 'image') {
      draft = { method: 'images.pull', request: { ...base, image_ref: compact(creationImage()) } };
    } else if (mode === 'volume') {
      draft = { method: 'volumes.create', request: { ...base, name: compact(creationName()), driver: compact(creationDriver()) || 'local' } };
    } else if (mode === 'pod') {
      draft = { method: 'pods.create', request: { ...base, name: compact(creationName()) } };
    } else if (mode === 'image-tag' && selected()) {
      draft = { method: 'images.tag', request: { ...base, image: resourceIdentity('images', selected()!), tag: compact(creationImage()) } };
    }
    if (!draft) return;
    setCreationMode(null);
    beginMutation(draft);
  };

  const openCreation = (mode: CreationMode) => {
    setCreationName('');
    setCreationImage('');
    setCreationDriver('local');
    setCreationCommand('');
    setCreationRestart('no');
    setCreationCPUs('');
    setCreationMemory('');
    setCreationMode(mode);
  };

  const loadLogs = async () => {
    if (!selectedIdentity()) return;
    setInspectorMode('logs');
    try {
      setLogs(await tailContainerLogs(selectedIdentity(), engine(), endpointID()));
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.logsFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    }
  };

  const openManagedService = () => {
    const owner = selectedManagedOwner();
    if (!owner) return;
    writeUIStorageJSON('webServices:focus', { version: 1, serviceID: owner.service_id });
    env.goActivity('ports');
  };

  const handleTableKey = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.key === 'Enter') {
      const item = filteredInventory()[index];
      if (item) selectResource(item);
      return;
    }
    const nextIndex = Math.max(0, Math.min(filteredInventory().length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const row = (event.currentTarget as HTMLElement | null)
      ?.closest<HTMLElement>('[data-container-page]')
      ?.querySelector<HTMLElement>(`[data-container-resource-row-index="${nextIndex}"]`);
    row?.focus();
  };

  const renderStructuredDetails = () => {
    const item = selected();
    if (!item) return null;
    const record = selectedDetailRecord();
    const runtime = detailRecord(record.runtime);
    const image = detailRecord(record.image);
    const createdAt = detailNumber(record, 'created_at_unix_ms');
    const ports = detailArray(record, 'ports').map(formatPort).filter(Boolean);
    const runtimeVisible = view() === 'containers' && (
      detailString(runtime, 'network_mode')
      || detailString(runtime, 'restart_policy')
      || detailString(runtime, 'user')
      || detailBoolean(runtime, 'privileged') !== undefined
      || detailBoolean(runtime, 'read_only_root') !== undefined
    );
    return (
      <div class="container-detail-stack" data-container-detail-grid>
        <DetailSection title={i18n.t('containers.inspector.overview')} icon={<Info class="h-4 w-4" />}>
          <dl>
            <Show when={view() === 'containers'}>
              <DetailRow label={i18n.t('containers.columns.image')} value={detailString(image, 'reference') || (item as ContainerInventoryItem).image?.reference || '—'} mono />
              <Show when={detailString(record, 'health') || (item as ContainerInventoryItem).health}>{(health) => <DetailRow label={i18n.t('containers.columns.health')} value={localizedResourceStatus(health())} />}</Show>
              <Show when={detailString(record, 'group_name') || (item as ContainerInventoryItem).group_name}>{(group) => <DetailRow label={i18n.t('containers.columns.group')} value={group()} />}</Show>
            </Show>
            <Show when={view() === 'images'}>
              <DetailRow label={i18n.t('containers.columns.size')} value={formatBytes(detailNumber(record, 'size_bytes') ?? (item as ImageInventoryItem).size_bytes)} />
              <DetailRow label={i18n.t('containers.columns.usage')} value={detailNumber(record, 'referenced_containers') ?? (item as ImageInventoryItem).referenced_containers} />
              <Show when={detailString(record, 'digest') || (item as ImageInventoryItem).digest}>{(digest) => <DetailRow label={i18n.t('containers.columns.digest')} value={digest()} mono />}</Show>
            </Show>
            <Show when={view() === 'volumes'}>
              <DetailRow label={i18n.t('containers.columns.driver')} value={detailString(record, 'driver') || (item as VolumeInventoryItem).driver || '—'} />
              <DetailRow label={i18n.t('containers.columns.scope')} value={detailString(record, 'scope') || (item as VolumeInventoryItem).scope || '—'} />
              <DetailRow label={i18n.t('containers.columns.usage')} value={detailNumber(record, 'referenced_containers') ?? (item as VolumeInventoryItem).referenced_containers} />
            </Show>
            <Show when={view() === 'compose-projects'}>
              <DetailRow label={i18n.t('containers.columns.running')} value={`${detailNumber(record, 'running_count') ?? (item as ComposeProjectInventoryItem).running_count} / ${detailNumber(record, 'container_count') ?? (item as ComposeProjectInventoryItem).container_count}`} />
              <DetailRow label={i18n.t('containers.columns.services')} value={detailNumber(record, 'service_count') ?? (item as ComposeProjectInventoryItem).service_count} />
            </Show>
            <Show when={view() === 'pods'}>
              <DetailRow label={i18n.t('containers.columns.running')} value={`${detailNumber(record, 'running_count') ?? (item as PodInventoryItem).running_count} / ${detailNumber(record, 'container_count') ?? (item as PodInventoryItem).container_count}`} />
            </Show>
            <Show when={createdAt || (item as ContainerInventoryItem | ImageInventoryItem | VolumeInventoryItem | PodInventoryItem).created_at_unix_ms}>{(value) => <DetailRow label={i18n.t('containers.columns.created')} value={formatDate(Number(value()))} />}</Show>
          </dl>
        </DetailSection>

        <Show when={runtimeVisible}>
          <DetailSection title={i18n.t('containers.inspector.runtime')} icon={<Cpu class="h-4 w-4" />}>
            <dl>
              <Show when={detailString(runtime, 'network_mode')}>{(value) => <DetailRow label={i18n.t('containers.inspector.networkMode')} value={value()} mono />}</Show>
              <Show when={detailString(runtime, 'restart_policy')}>{(value) => <DetailRow label={i18n.t('containers.fields.restartPolicy')} value={value()} mono />}</Show>
              <Show when={detailString(runtime, 'user')}>{(value) => <DetailRow label={i18n.t('containers.inspector.user')} value={value()} mono />}</Show>
              <Show when={detailBoolean(runtime, 'privileged') !== undefined}><DetailRow label={i18n.t('containers.inspector.privileged')} value={detailBoolean(runtime, 'privileged') ? i18n.t('common.actions.yes') : i18n.t('common.actions.no')} /></Show>
              <Show when={detailBoolean(runtime, 'read_only_root') !== undefined}><DetailRow label={i18n.t('containers.inspector.readOnlyRoot')} value={detailBoolean(runtime, 'read_only_root') ? i18n.t('common.actions.yes') : i18n.t('common.actions.no')} /></Show>
            </dl>
          </DetailSection>
        </Show>

        <Show when={ports.length > 0}>
          <DetailSection title={i18n.t('containers.inspector.ports')} icon={<Activity class="h-4 w-4" />}>
            <div class="flex flex-wrap gap-1.5"><For each={ports}>{(port) => <span class="container-detail-pill font-mono">{port}</span>}</For></div>
          </DetailSection>
        </Show>

        <details class="container-technical-details" data-container-technical-details>
          <summary>{i18n.t('containers.inspector.technicalDetails')}</summary>
          <pre>{JSON.stringify(details() ?? item, null, 2)}</pre>
        </details>
      </div>
    );
  };

  const renderResourceActions = () => {
    if (!selected() || selectedManagedOwner()) return null;
    if (view() === 'containers') {
      const state = (selected() as ContainerInventoryItem).state;
      return (
        <>
          <Show when={state !== 'running'}><Button size="sm" onClick={() => runAction('containers.start')} disabled={!canExecute()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button></Show>
          <Show when={state === 'running'}><Button size="sm" variant="outline" onClick={() => runAction('containers.stop')} disabled={!canExecute()}><Stop class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button></Show>
          <Button size="sm" variant="outline" onClick={() => runAction('containers.restart')} disabled={!canExecute()}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button>
          <Show when={state === 'running'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.pause')} disabled={!canExecute()}><Pause class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.pause')}</Button></Show>
          <Show when={state === 'paused'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.unpause')} disabled={!canExecute()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.resume')}</Button></Show>
          <Button size="sm" variant="ghost" onClick={() => runAction('containers.kill')} disabled={!canExecute() || !canAdmin()}>{i18n.t('containers.actions.kill')}</Button>
          <Button size="sm" variant="ghost" onClick={() => runAction('containers.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
        </>
      );
    }
    if (view() === 'images') return (
      <>
        <Button size="sm" variant="outline" onClick={() => openCreation('image-tag')} disabled={!canRWX()}>{i18n.t('containers.actions.tag')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('images.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
      </>
    );
    if (view() === 'volumes') return <Button size="sm" variant="ghost" onClick={() => runAction('volumes.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>;
    if (view() === 'compose-projects') return (
      <>
        <Button size="sm" onClick={() => runAction('compose.projects.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('compose.projects.down')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.down')}</Button>
      </>
    );
    return (
      <>
        <Button size="sm" onClick={() => runAction('pods.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('pods.remove')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.remove')}</Button>
      </>
    );
  };

  return (
    <div class={`redeven-containers flex h-full min-h-0 flex-col ${redevenSurfaceRoleClass('main')}`} data-container-page data-variant={props.variant ?? 'activity'}>
      <header class="container-command-header shrink-0 px-3 pt-3 md:px-5 md:pt-4">
        <div class="container-header-main">
          <div class="flex min-w-0 items-center gap-2.5">
            <div class="container-product-mark"><Layers class="h-5 w-5" aria-hidden="true" /></div>
            <h1 class="truncate text-base font-semibold tracking-tight">{i18n.t('containers.title')}</h1>
          </div>
          <div class="container-header-controls" data-container-endpoint-bar>
            <div class="container-engine-switch" role="radiogroup" aria-label={i18n.t('containers.engine')}>
              <For each={['docker', 'podman'] as const}>{(value) => (
                <button type="button" role="radio" aria-checked={engine() === value} class="container-touch-target" onClick={() => setCurrentEngine(value)}>{value}</button>
              )}</For>
            </div>
            <div class="container-endpoint-control min-w-0">
              <span class="container-endpoint-status" data-available={endpointStatus()?.available ? 'true' : 'false'} aria-hidden="true" />
              <label class="sr-only" for={`container-endpoint-${props.stateScope ?? 'activity'}`}>{i18n.t('containers.endpoint')}</label>
              <select
                id={`container-endpoint-${props.stateScope ?? 'activity'}`}
                class="container-touch-target min-w-0 flex-1 bg-transparent px-2 text-sm font-medium outline-none"
                title={`${endpointStatus()?.remote ? i18n.t('containers.endpointMeta.remote') : i18n.t('containers.endpointMeta.local')} · ${endpointStatus()?.engine_version ?? ''}`}
                value={endpointID()}
                onChange={(event) => setEndpointID(event.currentTarget.value)}
              >
                <For each={endpoints()}>{(endpoint) => <option value={endpoint.endpoint_id}>{endpoint.display_name}</option>}</For>
              </select>
              <span class="sr-only" role="status">{endpointStatus()?.available ? i18n.t('containers.status.connected') : i18n.t('containers.status.unavailable')}</span>
            </div>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => void loadInventory(true)} disabled={refreshing()} aria-label={i18n.t('containers.actions.refresh')} title={i18n.t('containers.actions.refresh')}><Refresh class={`h-4 w-4 ${refreshing() ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => setOperationsOpen(true)} aria-label={i18n.t('containers.operations.title')} title={i18n.t('containers.operations.title')}>
              <Activity class="h-4 w-4" aria-hidden="true" />
              <Show when={activeOperationCount() > 0}><span class="container-operation-count">{activeOperationCount()}</span></Show>
            </Button>
          </div>
        </div>

        <nav class="container-resource-nav mt-2 flex gap-1 overflow-x-auto" aria-label={i18n.t('containers.resourceNavigation')}>
          <For each={availableViews()}>{(item) => (
            <button type="button" class="container-touch-target" aria-current={view() === item ? 'page' : undefined} onClick={() => { setView(item); setSelectedIdentity(''); setSearchQuery(''); setResourceFilter('all'); }}>
              <ViewIcon view={item} class="h-4 w-4" />
              <span>{viewLabel(item)}</span>
            </button>
          )}</For>
        </nav>
      </header>

      <div class="container-content flex min-h-0 flex-1">
        <main class="flex min-w-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-2 md:px-5 md:pb-5 md:pt-3" aria-busy={loading()}>
          <section class="container-resource-toolbar shrink-0" data-container-summary>
            <div class="container-overview-visual">
              <div class="container-total-count">
                <strong>{inventory().length}</strong>
                <span>{viewLabel(view())}</span>
              </div>
              <div class="container-distribution">
                <div
                  class="container-distribution__track"
                  role="img"
                  aria-label={i18n.t('containers.summary.showing', { visible: activeResourceCount(), total: inventory().length })}
                >
                  <span class="container-distribution__active" style={`width: ${activeResourceShare()}%`} />
                  <span class="container-distribution__inactive" />
                </div>
                <div class="container-distribution__legend">
                  <button type="button" aria-pressed={resourceFilter() === 'active'} onClick={() => setResourceFilter(resourceFilter() === 'active' ? 'all' : 'active')}><span data-tone="active" />{filterLabel('active')} <strong>{activeResourceCount()}</strong></button>
                  <button type="button" aria-pressed={resourceFilter() === 'inactive'} onClick={() => setResourceFilter(resourceFilter() === 'inactive' ? 'all' : 'inactive')}><span data-tone="inactive" />{filterLabel('inactive')} <strong>{inactiveResourceCount()}</strong></button>
                </div>
              </div>
            </div>
            <div class="container-overview-actions">
              <div class="container-search-control">
                <Search class="h-4 w-4" aria-hidden="true" />
                <Input value={searchQuery()} onInput={(event) => setSearchQuery(event.currentTarget.value)} aria-label={i18n.t('containers.search.label')} placeholder={i18n.t('containers.search.placeholder')} />
                <Show when={searchQuery()}><button type="button" class="container-search-clear" onClick={() => setSearchQuery('')} aria-label={i18n.t('containers.search.clear')}><X class="h-3.5 w-3.5" /></button></Show>
              </div>
              <div class="container-filter-switch" role="group" aria-label={i18n.t('containers.filters.label')}>
                <button type="button" class="container-touch-target" aria-pressed={resourceFilter() === 'all'} onClick={() => setResourceFilter('all')}>{filterLabel('all')}</button>
                <Show when={managedResourceCount() > 0}><button type="button" class="container-touch-target" aria-pressed={resourceFilter() === 'managed'} onClick={() => setResourceFilter('managed')}><Layers class="h-3.5 w-3.5" /><span>{managedResourceCount()}</span><span class="sr-only">{filterLabel('managed')}</span></button></Show>
              </div>
              <div class="container-create-actions">
                <Show when={view() === 'images' || view() === 'volumes'}><Button size="sm" variant="outline" onClick={prune} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.prune')}</Button></Show>
                <Show when={view() === 'containers'}><Button size="sm" onClick={() => openCreation('container')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.container')}</Button></Show>
                <Show when={view() === 'images'}><Button size="sm" onClick={() => openCreation('image')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.image')}</Button></Show>
                <Show when={view() === 'volumes'}><Button size="sm" onClick={() => openCreation('volume')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.volume')}</Button></Show>
                <Show when={view() === 'pods'}><Button size="sm" onClick={() => openCreation('pod')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.pod')}</Button></Show>
              </div>
            </div>
          </section>

          <Show when={error()}><div class="mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />{error()}</div></Show>
          <div class="mt-2 min-h-0 flex-1 overflow-auto">
            <Show when={!loading()} fallback={<div class="grid gap-2" aria-label={i18n.t('containers.loading')}><For each={[1, 2, 3, 4, 5]}>{() => <div class="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />}</For></div>}>
              <Show when={inventory().length > 0} fallback={<div class="container-empty-state"><div class="container-empty-state__mark"><ViewIcon view={view()} class="h-6 w-6" /></div><div class="mt-3 text-sm font-medium">{i18n.t('containers.empty.title')}</div></div>}>
                <Show when={filteredInventory().length > 0} fallback={<div class="container-empty-state"><Search class="h-6 w-6 text-muted-foreground" /><div class="mt-3 text-sm font-medium">{i18n.t('containers.empty.filteredTitle')}</div><Button size="sm" variant="ghost" class="mt-2" onClick={() => { setSearchQuery(''); setResourceFilter('all'); }}>{i18n.t('containers.actions.clearFilters')}</Button></div>}>
                  <div class="container-resource-table-shell hidden lg:block">
                    <table class="w-full table-fixed text-left text-sm" data-container-resource-table>
                      <thead><tr><th class="w-[42%]">{i18n.t('containers.columns.name')}</th><th class="w-[36%]">{secondaryColumnLabel()}</th><th>{tertiaryColumnLabel()}</th></tr></thead>
                      <tbody>
                        <For each={filteredInventory()}>{(item, index) => (
                          <tr tabindex={0} data-container-resource-row-index={index()} aria-selected={selectedIdentity() === resourceIdentity(view(), item)} onClick={() => selectResource(item)} onKeyDown={(event) => handleTableKey(event, index())}>
                            <td><div class="flex min-w-0 items-center gap-3"><div class="container-resource-icon" data-tone={resourceStatusTone(resourceStatus(view(), item))}><ViewIcon view={view()} class="h-4 w-4" /></div><div class="min-w-0"><div class="flex min-w-0 items-center gap-2"><div class="truncate font-medium text-foreground">{resourceName(view(), item)}</div><Show when={resourceManagement(item)?.managed}><span class="container-managed-label" title={i18n.t('containers.managed.badge')} aria-label={i18n.t('containers.managed.badge')}><Layers class="h-3.5 w-3.5" /></span></Show></div></div></div></td>
                            <td class="text-xs text-muted-foreground">
                              <Show when={view() === 'containers'}><span class="block truncate font-mono text-foreground/80" title={(item as ContainerInventoryItem).image?.reference}>{(item as ContainerInventoryItem).image?.reference || '—'}</span></Show>
                              <Show when={view() === 'images'}><span class="tabular-nums text-foreground/80">{formatBytes((item as ImageInventoryItem).size_bytes)}</span></Show>
                              <Show when={view() === 'volumes'}><span class="text-foreground/80">{(item as VolumeInventoryItem).driver || '—'}</span><Show when={(item as VolumeInventoryItem).scope}><span class="ml-1.5 text-muted-foreground">· {(item as VolumeInventoryItem).scope}</span></Show></Show>
                              <Show when={view() === 'compose-projects'}><span class="font-medium tabular-nums text-foreground/80">{(item as ComposeProjectInventoryItem).running_count} / {(item as ComposeProjectInventoryItem).container_count}</span></Show>
                              <Show when={view() === 'pods'}><span class="font-medium tabular-nums text-foreground/80">{(item as PodInventoryItem).running_count} / {(item as PodInventoryItem).container_count}</span></Show>
                            </td>
                            <td>
                              <Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), item))}>
                                <span class="text-xs tabular-nums text-muted-foreground">{i18n.t('containers.usage.containers', { count: Number(resourceStatus(view(), item)) })}</span>
                              </Show>
                              <Show when={view() === 'containers' && (item as ContainerInventoryItem).health && (item as ContainerInventoryItem).health !== 'healthy'}><div class="mt-1 text-[10px] text-[var(--redeven-status-warning-foreground)]">{localizedResourceStatus((item as ContainerInventoryItem).health ?? '')}</div></Show>
                            </td>
                          </tr>
                        )}</For>
                      </tbody>
                    </table>
                  </div>
                  <div class="grid gap-2 lg:hidden" data-container-mobile-list>
                    <For each={filteredInventory()}>{(item) => (
                      <button type="button" class="container-mobile-card container-touch-target" aria-pressed={selectedIdentity() === resourceIdentity(view(), item)} onClick={() => selectResource(item)}>
                        <div class="flex min-w-0 items-center gap-3"><div class="container-resource-icon" data-tone={resourceStatusTone(resourceStatus(view(), item))}><ViewIcon view={view()} class="h-4 w-4" /></div><div class="min-w-0 flex-1"><div class="flex min-w-0 items-center gap-2"><div class="truncate text-sm font-medium">{resourceName(view(), item)}</div><Show when={resourceManagement(item)?.managed}><span class="container-managed-label" title={i18n.t('containers.managed.badge')}><Layers class="h-3.5 w-3.5" /></span></Show></div><div class="mt-1 truncate text-xs text-muted-foreground">{view() === 'containers' ? (item as ContainerInventoryItem).image?.reference || '—' : view() === 'images' ? formatBytes((item as ImageInventoryItem).size_bytes) : view() === 'volumes' ? (item as VolumeInventoryItem).driver || '—' : `${(item as ComposeProjectInventoryItem | PodInventoryItem).running_count} / ${(item as ComposeProjectInventoryItem | PodInventoryItem).container_count}`}</div></div><Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), item))}><span class="text-xs text-muted-foreground">{Number(resourceStatus(view(), item))}</span></Show></div>
                      </button>
                    )}</For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </main>

        <Show when={selected()}>
          <aside class={`container-inspector z-20 flex w-[390px] shrink-0 flex-col max-lg:fixed max-lg:inset-0 max-lg:w-auto ${redevenSurfaceRoleClass('panel')}`} aria-label={i18n.t('containers.inspector.title')}>
            <div class="container-inspector__header flex min-h-[68px] items-center gap-3 px-4"><div class="container-resource-icon container-resource-icon--large" data-tone={resourceStatusTone(resourceStatus(view(), selected()!))}><ViewIcon view={view()} class="h-4 w-4" /></div><div class="min-w-0 flex-1"><div class="flex min-w-0 items-center gap-2"><div class="truncate text-sm font-semibold">{resourceName(view(), selected()!)}</div><Show when={view() !== 'images' && view() !== 'volumes'}>{renderStatus(resourceStatus(view(), selected()!))}</Show></div></div><Button size="sm" variant="ghost" class="container-icon-action" onClick={() => setSelectedIdentity('')} aria-label={i18n.t('containers.actions.close')}><X class="h-4 w-4" /></Button></div>
            <Show when={view() === 'containers'}><div class="container-inspector-tabs" role="tablist" aria-label={i18n.t('containers.inspector.title')}><button type="button" role="tab" aria-selected={inspectorMode() === 'details'} onClick={() => setInspectorMode('details')}><Info class="h-3.5 w-3.5" />{i18n.t('containers.inspector.details')}</button><button type="button" role="tab" aria-selected={inspectorMode() === 'logs'} onClick={() => void loadLogs()}><FileText class="h-3.5 w-3.5" />{i18n.t('containers.inspector.logs')}</button><button type="button" role="tab" aria-selected={inspectorMode() === 'stats'} onClick={() => setInspectorMode('stats')}><Activity class="h-3.5 w-3.5" />{i18n.t('containers.inspector.stats')}</button></div></Show>
            <div class="min-h-0 flex-1 overflow-auto p-4">
              <Show when={selectedManagedOwner()} keyed>{(owner) => <button type="button" class="container-managed-card mb-4" onClick={openManagedService}><span class="container-managed-card__mark"><Layers class="h-3.5 w-3.5" /></span><span class="min-w-0 flex-1 truncate text-left"><span class="block text-[10px] text-muted-foreground">{i18n.t('containers.managed.badge')}</span><strong class="block truncate text-xs font-medium">{owner.name}</strong></span><ExternalLink class="h-3.5 w-3.5" aria-hidden="true" /></button>}</Show>
              <Show when={inspectorMode() === 'details'}>{renderStructuredDetails()}</Show>
              <Show when={inspectorMode() === 'logs'}><div class="container-log-view"><Show when={logs()} fallback={<span class="text-muted-foreground">{i18n.t('containers.loading')}</span>}><For each={logs() ?? []}>{(line) => <div class="whitespace-pre-wrap break-all">{line.message}</div>}</For></Show></div></Show>
              <Show when={inspectorMode() === 'stats'}><Show when={stats()} fallback={<div class="text-sm text-muted-foreground">{i18n.t('containers.loading')}</div>}>{(value) => <div class="container-stats-visual"><div class="container-cpu-gauge" style={`--container-cpu-usage: ${Math.min(360, Math.max(0, value().cpu_percent * 3.6))}deg`}><div><strong>{value().cpu_percent.toFixed(1)}%</strong><span>{i18n.t('containers.stats.cpu')}</span></div></div><div class="container-stat-list"><StatMetric icon={<Database class="h-4 w-4" />} label={i18n.t('containers.stats.memory')} value={formatBytes(value().memory_bytes)} /><StatMetric icon={<ArrowDown class="h-4 w-4" />} label={i18n.t('containers.stats.networkIn')} value={formatBytes(value().network_rx_bytes)} /><StatMetric icon={<ArrowUp class="h-4 w-4" />} label={i18n.t('containers.stats.networkOut')} value={formatBytes(value().network_tx_bytes)} /></div></div>}</Show></Show>
            </div>
            <Show when={!selectedManagedOwner()}><div class="container-inspector__actions flex flex-wrap gap-2 p-3">{renderResourceActions()}</div></Show>
          </aside>
        </Show>
      </div>

      <EnvAppDrawer open={operationsOpen()} onOpenChange={setOperationsOpen} title={i18n.t('containers.operations.title')} description={i18n.t('containers.operations.description')} bodyClass="min-h-0">
        <div class="max-h-[70vh] space-y-2 overflow-auto p-1" data-container-operations>
          <Show when={operations().length > 0} fallback={<div class="py-12 text-center text-sm text-muted-foreground">{i18n.t('containers.operations.empty')}</div>}>
            <For each={operations()}>{(operation) => <div class={`container-operation-card ${redevenSurfaceRoleClass('panel')}`} data-state={operation.state}><div class="flex items-start gap-3"><span class="container-operation-card__state" aria-hidden="true" /><div class="min-w-0 flex-1"><div class="truncate text-sm font-medium">{operationLabel(operation.method)}</div><div class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{operation.resource_identity}</div><div class="mt-1 text-[10px] text-muted-foreground">{i18n.formatRelativeTime(operation.updated_at_unix_ms)}</div></div><Tag variant={operation.state === 'succeeded' ? 'success' : operation.state === 'failed' || operation.state === 'interrupted' ? 'error' : 'neutral'} tone="soft" size="sm">{operationStateLabel(operation.state)}</Tag></div><Show when={operation.error_message}><p class="mt-2 text-xs text-destructive">{operation.error_message}</p></Show><Show when={operationActive(operation)}><Button size="sm" variant="ghost" class="mt-2" onClick={() => void cancelContainerOperation(operation.operation_id).then(loadOperations)} disabled={!canExecute()}>{i18n.t('containers.actions.cancel')}</Button></Show></div>}</For>
          </Show>
        </div>
      </EnvAppDrawer>

      <Dialog open={creationMode() !== null} onOpenChange={(open) => !open && setCreationMode(null)} title={creationMode() === 'image-tag' ? i18n.t('containers.create.tagTitle') : i18n.t('containers.create.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setCreationMode(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={submitCreation} disabled={mutationBusy() || (creationMode() === 'container' && !compact(creationImage())) || (creationMode() !== 'container' && !compact(creationName() || creationImage()))}>{i18n.t('containers.actions.review')}</Button></div>}>
        <div class="space-y-4">
          <Show when={creationMode() === 'container'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label><label class="block text-sm font-medium">{i18n.t('containers.fields.image')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="ghcr.io/example/app:latest" /></label><details class="rounded-lg border p-3"><summary class="cursor-pointer text-sm font-medium">{i18n.t('containers.create.advanced')}</summary><div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="text-xs">{i18n.t('containers.fields.command')}<Input class="mt-1" value={creationCommand()} onInput={(event) => setCreationCommand(event.currentTarget.value)} /></label><label class="text-xs">{i18n.t('containers.fields.restartPolicy')}<select class="container-touch-target mt-1 w-full rounded-md border bg-background px-2" value={creationRestart()} onChange={(event) => setCreationRestart(event.currentTarget.value)}><option value="no">no</option><option value="always">always</option><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option></select></label><label class="text-xs">{i18n.t('containers.fields.cpus')}<Input class="mt-1" inputmode="decimal" value={creationCPUs()} onInput={(event) => setCreationCPUs(event.currentTarget.value)} /></label><label class="text-xs">{i18n.t('containers.fields.memory')}<Input class="mt-1" inputmode="numeric" value={creationMemory()} onInput={(event) => setCreationMemory(event.currentTarget.value)} /></label></div></details></Show>
          <Show when={creationMode() === 'image'}><label class="block text-sm font-medium">{i18n.t('containers.fields.image')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="docker.io/library/nginx:latest" /></label></Show>
          <Show when={creationMode() === 'volume'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label><label class="block text-sm font-medium">{i18n.t('containers.fields.driver')}<Input class="mt-1.5" value={creationDriver()} onInput={(event) => setCreationDriver(event.currentTarget.value)} /></label></Show>
          <Show when={creationMode() === 'pod'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label></Show>
          <Show when={creationMode() === 'image-tag'}><label class="block text-sm font-medium">{i18n.t('containers.fields.tag')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="example/app:release" /></label></Show>
        </div>
      </Dialog>

      <Dialog open={pendingConfirmation() !== null} onOpenChange={(open) => !open && setPendingConfirmation(null)} title={i18n.t('containers.confirm.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setPendingConfirmation(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" variant="default" onClick={submitConfirmation} disabled={confirmation() !== pendingConfirmation()?.confirmationValue || mutationBusy()}>{i18n.t('containers.actions.review')}</Button></div>}>
        <div class="rounded-lg border border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] p-3"><div class="flex gap-2 text-sm font-medium text-[var(--redeven-status-warning-foreground)]"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.confirm.warning')}</div><p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('containers.confirm.typeName', { name: pendingConfirmation()?.confirmationLabel ?? '' })}</p></div>
        <Input class="mt-4" value={confirmation()} onInput={(event) => setConfirmation(event.currentTarget.value)} autocomplete="off" />
      </Dialog>

      <Dialog open={review() !== null} onOpenChange={(open) => !open && setReview(null)} title={i18n.t('containers.review.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setReview(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={() => void runReviewedOperation()} disabled={mutationBusy() || (review()?.preflight.plan.requires_admin && !canAdmin())}>{i18n.t('containers.actions.run')}</Button></div>}>
        <Show when={review()} keyed>{(current) => <div class="space-y-3"><div class="flex items-center justify-between rounded-lg border p-3"><div><div class="text-xs text-muted-foreground">{i18n.t('containers.review.operation')}</div><div class="mt-1 font-mono text-sm">{current.preflight.method}</div></div><Tag variant={current.preflight.plan.risk_level === 'high' || current.preflight.plan.risk_level === 'critical' ? 'warning' : 'neutral'} tone="soft" size="sm">{current.preflight.plan.risk_level}</Tag></div><For each={current.preflight.plan.summary ?? []}>{(summary) => <p class="text-sm text-muted-foreground">{summary}</p>}</For><For each={current.preflight.plan.risk_flags ?? []}>{(flag) => <div class="rounded-lg border border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] p-3"><div class="text-sm font-medium text-[var(--redeven-status-warning-foreground)]">{flag.title}</div><p class="mt-1 text-xs leading-5 text-muted-foreground">{flag.detail}</p></div>}</For><Show when={current.preflight.plan.requires_admin && !canAdmin()}><p class="text-sm text-destructive">{i18n.t('containers.permissions.admin')}</p></Show><div class="grid gap-1 rounded-lg bg-muted/40 p-3 font-mono text-[10px] text-muted-foreground"><span>{current.preflight.request_hash}</span><span>{current.preflight.plan_hash}</span></div></div>}</Show>
      </Dialog>
    </div>
  );
}

function StatMetric(props: { icon: JSX.Element; label: string; value: string }) {
  return <div class="container-stat-metric"><span aria-hidden="true">{props.icon}</span><div><span>{props.label}</span><strong>{props.value}</strong></div></div>;
}
