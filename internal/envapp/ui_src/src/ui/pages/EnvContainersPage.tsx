import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Folder,
  FileText,
  Info,
  Layers,
  Maximize,
  MoreVertical,
  Package,
  Pause,
  Play,
  Plus,
  Refresh,
  Search,
  Settings,
  Terminal,
  Stop,
  Trash,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { Button, Dropdown, Input, MonitoringChart, Tabs, Tag, type DropdownItem, type TabItem } from '@floegence/floe-webapp-core/ui';

import { Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import {
  cancelContainerOperation,
  createContainerOperation,
  getContainerEndpointStatus,
  getContainerImageHistory,
  getRawContainerInspect,
  getContainerResourceDetails,
  listContainerEndpoints,
  listContainerOperations,
  listContainerResources,
  listContainerResourceFiles,
  readContainerResourceFile,
  preflightContainerOperation,
  subscribeContainerOperation,
  subscribeContainerLogs,
  subscribeContainerStats,
  subscribeContainerStatsCollection,
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
  type ContainerImageHistoryEntry,
  type ContainerResourceFileEntry,
  type ImageInventoryItem,
  type PodInventoryItem,
  type VolumeInventoryItem,
} from '../services/containerResourcesApi';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { subscribeContainerResourceNavigation } from '../services/containerResourceNavigation';
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
type DetailTab = 'overview' | 'logs' | 'inspect' | 'mounts' | 'exec' | 'files' | 'stats' | 'layers' | 'used-by' | 'containers';
type ResourceSortKey = 'status' | 'name' | 'secondary' | 'created';
type ResourceSortDirection = 'ascending' | 'descending';

type DetailRecord = Readonly<Record<string, unknown>>;

type ContainerConsoleTarget = Readonly<{
  engine: ContainerEngine;
  endpointID: string;
  view: ContainerResourceView;
  selectedIdentity: string;
}>;

type ContainerConsoleState =
  | Readonly<{ phase: 'loading'; target: ContainerConsoleTarget; endpoints: readonly ContainerEndpoint[]; endpoint: ContainerEndpoint | null }>
  | Readonly<{ phase: 'ready'; target: ContainerConsoleTarget; endpoints: readonly ContainerEndpoint[]; endpoint: ContainerEndpoint; inventory: readonly ContainerResourceInventoryItem[]; refreshing: boolean }>
  | Readonly<{ phase: 'unavailable' | 'permission'; target: ContainerConsoleTarget; endpoints: readonly ContainerEndpoint[]; endpoint: ContainerEndpoint | null }>
  | Readonly<{ phase: 'error'; target: ContainerConsoleTarget; endpoints: readonly ContainerEndpoint[]; endpoint: ContainerEndpoint | null; message: string }>;

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
  const views = availableResourceViews(engine);
  const view = views.includes(candidate?.view as ContainerResourceView)
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

function availableResourceViews(engine: ContainerEngine): readonly ContainerResourceView[] {
  return engine === 'podman'
    ? ['containers', 'images', 'volumes', 'pods']
    : ['containers', 'images', 'volumes', 'compose-projects'];
}

function normalizeConsoleTarget(target: ContainerConsoleTarget): ContainerConsoleTarget {
  const views = availableResourceViews(target.engine);
  return {
    engine: target.engine,
    endpointID: compact(target.endpointID),
    view: views.includes(target.view) ? target.view : target.engine === 'podman' ? 'pods' : 'compose-projects',
    selectedIdentity: compact(target.selectedIdentity),
  };
}

function inventoryCacheKey(target: Pick<ContainerConsoleTarget, 'engine' | 'endpointID' | 'view'>): string {
  return `${target.engine}\u0000${target.endpointID}\u0000${target.view}`;
}

function resourceIdentity(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).container_id);
    case 'images': {
      const image = item as ImageInventoryItem;
      return compact(image.id || image.digest || image.tags?.[0] || image.reference);
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
  return ['running', 'restarting', 'paused', 'up', 'healthy', 'partial'].includes(resourceStatus(view, item).toLowerCase());
}

function endpointIssueFromError(cause: unknown): 'unavailable' | 'permission' | null {
  const code = compact((cause as { code?: unknown } | null)?.code);
  if (code === 'ENGINE_PERMISSION_DENIED') return 'permission';
  if (code === 'ENGINE_UNAVAILABLE') return 'unavailable';
  return null;
}

function defaultResourceFilter(view: ContainerResourceView): ResourceFilter {
  return view === 'containers' ? 'active' : 'all';
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

function formatByteRate(value: number | undefined): string {
  const bytes = Number(value ?? 0);
  return `${bytes > 0 ? formatBytes(bytes) : '0 B'}/s`;
}

function formatPercent(value: number | undefined): string {
  const percent = Number(value ?? 0);
  return `${Number.isFinite(percent) ? percent.toFixed(1) : '0.0'}%`;
}

function chartTimeLabel(timestamp: number | undefined): string {
  const normalized = Number(timestamp ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return '';
  const date = new Date(normalized);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function utilizationScaleMaximum(values: readonly number[]): number {
  const peak = Math.max(0, ...values.filter(Number.isFinite));
  if (peak <= 1) return 1;
  if (peak <= 5) return 5;
  if (peak <= 10) return 10;
  if (peak <= 25) return 25;
  if (peak <= 50) return 50;
  return 100;
}

function cpuScaleMaximum(values: readonly number[]): number {
  const peak = Math.max(0, ...values.filter(Number.isFinite));
  if (peak <= 50) return utilizationScaleMaximum(values);
  return Math.ceil(peak / 100) * 100;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function networkRateSeries(
  history: readonly ContainerStats[],
  key: 'network_rx_bytes' | 'network_tx_bytes',
): number[] {
  return history.map((sample, index) => {
    if (index === 0) return 0;
    const previous = history[index - 1];
    const elapsedSeconds = (Number(sample.sampled_at_unix_ms ?? 0) - Number(previous.sampled_at_unix_ms ?? 0)) / 1000;
    const delta = sample[key] - previous[key];
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(delta) || delta < 0) return 0;
    return delta / elapsedSeconds;
  });
}

function normalizedStatsSample(sample: ContainerStats): ContainerStats {
  const timestamp = Number(sample.sampled_at_unix_ms ?? 0);
  return timestamp > 0 && Number.isFinite(timestamp)
    ? sample
    : { ...sample, sampled_at_unix_ms: Date.now() };
}

function mergeStatsSample(history: readonly ContainerStats[], sample: ContainerStats): ContainerStats[] {
  const timestamp = Number(sample.sampled_at_unix_ms ?? 0);
  return [...history.filter((item) => Number(item.sampled_at_unix_ms ?? 0) !== timestamp), sample]
    .sort((left, right) => Number(left.sampled_at_unix_ms ?? 0) - Number(right.sampled_at_unix_ms ?? 0))
    .slice(-60);
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
  const restoredTarget: ContainerConsoleTarget = normalizeConsoleTarget(restored);
  const [consoleState, setConsoleState] = createSignal<ContainerConsoleState>({
    phase: 'loading',
    target: restoredTarget,
    endpoints: [],
    endpoint: null,
  });
  const [details, setDetails] = createSignal<unknown>(null);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [resourceFilter, setResourceFilter] = createSignal<ResourceFilter>(defaultResourceFilter(restored.view));
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
  const [statsHistory, setStatsHistory] = createSignal<ContainerStats[]>([]);
  const [collectionStats, setCollectionStats] = createSignal<ReadonlyMap<string, ContainerStats>>(new Map());
  const [chartsOpen, setChartsOpen] = createSignal(false);
  const [showSecondaryColumn, setShowSecondaryColumn] = createSignal(true);
  const [showPortsColumn, setShowPortsColumn] = createSignal(true);
  const [showCreatedColumn, setShowCreatedColumn] = createSignal(true);
  const [sortKey, setSortKey] = createSignal<ResourceSortKey>('name');
  const [sortDirection, setSortDirection] = createSignal<ResourceSortDirection>('ascending');
  const [detailTab, setDetailTab] = createSignal<DetailTab>('overview');
  const [logQuery, setLogQuery] = createSignal('');
  const [logsPaused, setLogsPaused] = createSignal(false);
  const [logsWrap, setLogsWrap] = createSignal(true);
  const [rawInspect, setRawInspect] = createSignal<unknown>(null);
  const [rawInspectLoading, setRawInspectLoading] = createSignal(false);
  const [imageHistory, setImageHistory] = createSignal<ContainerImageHistoryEntry[]>([]);
  const [imageHistoryLoading, setImageHistoryLoading] = createSignal(false);
  const [imageHistoryError, setImageHistoryError] = createSignal('');
  const [statsLoading, setStatsLoading] = createSignal(false);
  const [statsError, setStatsError] = createSignal('');
  const [filePath, setFilePath] = createSignal('/');
  const [fileEntries, setFileEntries] = createSignal<ContainerResourceFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = createSignal(false);
  const [filePreview, setFilePreview] = createSignal('');
  const [filePreviewName, setFilePreviewName] = createSignal('');
  let consoleLoadGeneration = 0;
  let consoleLoadAbort: AbortController | null = null;
  let waitingForEnvironment = false;
  const inventoryCache = new Map<string, readonly ContainerResourceInventoryItem[]>();
  let operationStreamAbort: AbortController | null = null;
  let logViewElement: HTMLDivElement | undefined;
  let inventoryScrollElement: HTMLDivElement | undefined;
  let storedInventoryScrollTop = 0;

  const permissions = createMemo(() => env.env()?.permissions);
  const canRead = createMemo(() => Boolean(permissions()?.can_read));
  const canExecute = createMemo(() => canRead() && Boolean(permissions()?.can_execute));
  const canRWX = createMemo(() => canExecute() && Boolean(permissions()?.can_write));
  const canAdmin = createMemo(() => Boolean(permissions()?.can_admin || permissions()?.is_owner));
  const readyConsole = createMemo(() => {
    const state = consoleState();
    return state.phase === 'ready' ? state : null;
  });
  const engine = () => consoleState().target.engine;
  const endpointID = () => consoleState().target.endpointID;
  const view = () => consoleState().target.view;
  const selectedIdentity = () => consoleState().target.selectedIdentity;
  const endpoints = () => consoleState().endpoints;
  const endpointStatus = () => consoleState().endpoint;
  const inventory = () => readyConsole()?.inventory ?? [];
  const loading = () => consoleState().phase === 'loading';
  const refreshing = () => Boolean(readyConsole()?.refreshing);
  const consoleBusy = () => loading() || refreshing();
  const availableViews = createMemo<readonly ContainerResourceView[]>(() => availableResourceViews(engine()));
  const selected = createMemo(() => {
    const identity = selectedIdentity();
    if (!identity) return null;
    return inventory().find((item) => resourceIdentity(view(), item) === identity) ?? null;
  });
  const selectedManagedOwner = createMemo(() => resourceManagement(selected())?.owner ?? null);
  const activeOperationCount = createMemo(() => operations().filter(operationActive).length);
  const activeResourceCount = createMemo(() => inventory().filter((item) => resourceActive(view(), item)).length);
  const managedResourceCount = createMemo(() => inventory().filter((item) => resourceManagement(item)?.managed).length);
  const filteredInventory = createMemo(() => {
    const query = searchQuery().trim().toLocaleLowerCase();
    const filter = resourceFilter();
    const items = inventory().filter((item) => {
      if (query && !resourceSearchText(view(), item).includes(query)) return false;
      if (filter === 'active' && !resourceActive(view(), item)) return false;
      if (filter === 'inactive' && resourceActive(view(), item)) return false;
      if (filter === 'managed' && !resourceManagement(item)?.managed) return false;
      return true;
    });
    const valueForSort = (item: ContainerResourceInventoryItem): string | number => {
      switch (sortKey()) {
        case 'status': return resourceStatus(view(), item);
        case 'name': return resourceName(view(), item);
        case 'created': return (item as ImageInventoryItem | VolumeInventoryItem | PodInventoryItem).created_at_unix_ms ?? 0;
        case 'secondary':
          if (view() === 'containers') return (item as ContainerInventoryItem).image?.reference ?? '';
          if (view() === 'images') return (item as ImageInventoryItem).size_bytes ?? 0;
          if (view() === 'volumes') return (item as VolumeInventoryItem).driver ?? '';
          return (item as ComposeProjectInventoryItem | PodInventoryItem).running_count ?? 0;
      }
    };
    return [...items].sort((left, right) => {
      const leftValue = valueForSort(left);
      const rightValue = valueForSort(right);
      const result = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      return sortDirection() === 'ascending' ? result : -result;
    });
  });
  const selectedDetailRecord = createMemo(() => {
    const loaded = detailRecord(details());
    const projected = detailRecord(loaded.project);
    return Object.keys(projected).length > 0 ? projected : Object.keys(loaded).length > 0 ? loaded : detailRecord(selected());
  });

  const filteredLogs = createMemo(() => {
    const query = logQuery().trim().toLocaleLowerCase();
    if (!query) return logs() ?? [];
    return (logs() ?? []).filter((line) => line.message.toLocaleLowerCase().includes(query));
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

  const resetResourceContext = () => {
    setDetails(null);
    setLogs(null);
    setStats(null);
    setStatsHistory([]);
    setCollectionStats(new Map());
    setRawInspect(null);
    setRawInspectLoading(false);
    setImageHistory([]);
    setImageHistoryLoading(false);
    setImageHistoryError('');
    setStatsLoading(false);
    setStatsError('');
    setFilePath('/');
    setFileEntries([]);
    setFilesLoading(false);
    setFilePreview('');
    setFilePreviewName('');
    setCreationMode(null);
    setPendingConfirmation(null);
    setConfirmation('');
    setReview(null);
    setMutationBusy(false);
  };

  const loadConsole = async (
    requestedTarget: ContainerConsoleTarget,
    options: Readonly<{ forceConnectionCheck?: boolean; resetListControls?: boolean; notifyIfSelectionMissing?: boolean }> = {},
  ) => {
    const target = normalizeConsoleTarget(requestedTarget);
    const previous = consoleState();
    const hasMatchingConnection = Boolean(previous.endpoint?.available)
      && previous.target.engine === target.engine
      && (!target.endpointID || previous.target.endpointID === target.endpointID);
    let nextEndpoints = hasMatchingConnection ? previous.endpoints : [];
    let nextEndpoint = hasMatchingConnection ? previous.endpoint : null;
    const loadingTarget = nextEndpoint
      ? { ...target, endpointID: nextEndpoint.endpoint_id }
      : target;

    consoleLoadAbort?.abort();
    const controller = new AbortController();
    consoleLoadAbort = controller;
    const generation = ++consoleLoadGeneration;
    const current = () => generation === consoleLoadGeneration && !controller.signal.aborted;

    const cachedInventory = nextEndpoint
      ? inventoryCache.get(inventoryCacheKey({ ...loadingTarget, endpointID: nextEndpoint.endpoint_id }))
      : undefined;
    if (cachedInventory && nextEndpoint) {
      setConsoleState({ phase: 'ready', target: loadingTarget, endpoints: nextEndpoints, endpoint: nextEndpoint, inventory: cachedInventory, refreshing: true });
    } else {
      setConsoleState({ phase: 'loading', target: loadingTarget, endpoints: nextEndpoints, endpoint: nextEndpoint });
    }
    resetResourceContext();
    if (options.resetListControls) {
      setSearchQuery('');
      setResourceFilter(defaultResourceFilter(target.view));
      setDetailTab('overview');
      setChartsOpen(false);
    }

    if (env.env() === undefined) {
      waitingForEnvironment = true;
      return;
    }
    waitingForEnvironment = false;
    if (!canRead()) {
      if (current()) setConsoleState({ phase: 'permission', target: loadingTarget, endpoints: [], endpoint: null });
      return;
    }

    try {
      if (!nextEndpoint || options.forceConnectionCheck) {
        nextEndpoints = await listContainerEndpoints(target.engine, controller.signal);
        if (!current()) return;
        const preferred = nextEndpoints.find((item) => item.endpoint_id === target.endpointID);
        if (target.endpointID && !preferred) {
          setConsoleState({ phase: 'unavailable', target, endpoints: nextEndpoints, endpoint: null });
          return;
        }
        nextEndpoint = preferred ?? nextEndpoints.find((item) => item.default) ?? nextEndpoints[0] ?? null;
        if (!nextEndpoint) {
          setConsoleState({ phase: 'unavailable', target: { ...target, endpointID: '' }, endpoints: nextEndpoints, endpoint: null });
          return;
        }
        nextEndpoint = await getContainerEndpointStatus(target.engine, nextEndpoint.endpoint_id, controller.signal);
        if (!current()) return;
      }

      const resolvedTarget = { ...target, endpointID: nextEndpoint.endpoint_id };
      if (!nextEndpoint.available) {
        setConsoleState({ phase: 'unavailable', target: resolvedTarget, endpoints: nextEndpoints, endpoint: nextEndpoint });
        return;
      }

      const items = await listContainerResources(target.view, target.engine, nextEndpoint.endpoint_id, controller.signal);
      if (!current()) return;
      const selectedStillExists = !target.selectedIdentity
        || items.some((item) => resourceIdentity(target.view, item) === target.selectedIdentity);
      const readyTarget = selectedStillExists ? resolvedTarget : { ...resolvedTarget, selectedIdentity: '' };
      inventoryCache.set(inventoryCacheKey(readyTarget), items);
      setConsoleState({ phase: 'ready', target: readyTarget, endpoints: nextEndpoints, endpoint: nextEndpoint, inventory: items, refreshing: false });
      if (!selectedStillExists && options.notifyIfSelectionMissing) {
        notify.info(i18n.t('containers.notifications.inventoryChangedTitle'), i18n.t('containers.notifications.inventoryChangedMessage'));
      }
    } catch (cause) {
      if (!current()) return;
      const issue = endpointIssueFromError(cause);
      const failedTarget = nextEndpoint ? { ...target, endpointID: nextEndpoint.endpoint_id } : target;
      if (issue) {
        setConsoleState({ phase: issue, target: failedTarget, endpoints: nextEndpoints, endpoint: nextEndpoint });
      } else {
        setConsoleState({
          phase: 'error',
          target: failedTarget,
          endpoints: nextEndpoints,
          endpoint: nextEndpoint,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  };

  const reloadConsole = (forceConnectionCheck = false) => loadConsole(
    consoleState().target,
    { forceConnectionCheck, notifyIfSelectionMissing: true },
  );

  const setSelectedIdentity = (identity: string) => {
    setConsoleState((state) => ({ ...state, target: { ...state.target, selectedIdentity: compact(identity) } }));
  };

  createEffect(() => {
    const environment = env.env();
    if (environment === undefined || !waitingForEnvironment) return;
    waitingForEnvironment = false;
    void loadConsole(consoleState().target, { forceConnectionCheck: true });
  });

  onMount(() => {
    void loadConsole(restoredTarget, { forceConnectionCheck: true });
    if (compact(props.stateScope) && props.stateScope !== 'activity') return;
    const unsubscribe = subscribeContainerResourceNavigation((request) => {
      const next = normalizeConsoleTarget(sanitizePersistedState(request));
      void loadConsole(next, { forceConnectionCheck: true, resetListControls: true });
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const ready = readyConsole();
    const identity = ready?.target.selectedIdentity ?? '';
    if (!identity) {
      setDetails(null);
      return;
    }
    let active = true;
    getContainerResourceDetails(ready!.target.view, identity, ready!.target.engine, ready!.target.endpointID)
      .then((value) => active && setDetails(value))
      .catch(() => active && setDetails(null));
    onCleanup(() => { active = false; });
  });

  createEffect(() => {
    if (!operations().some(operationActive)) return;
    const timer = window.setInterval(() => void loadOperations(), 1200);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const ready = readyConsole();
    if (!ready || !chartsOpen() || ready.target.view !== 'containers' || !ready.endpoint.capabilities?.collection_stats) {
      setCollectionStats(new Map());
      return;
    }
    const controller = new AbortController();
    void subscribeContainerStatsCollection(ready.target.engine, ready.target.endpointID, (sample) => {
      if (controller.signal.aborted) return;
      setCollectionStats(new Map(sample.samples.map((item) => [item.container_id, item])));
    }, controller.signal).catch(() => {
      if (!controller.signal.aborted) setCollectionStats(new Map());
    });
    onCleanup(() => controller.abort());
  });

  createEffect(() => {
    const ready = readyConsole();
    if (!ready || detailTab() !== 'stats' || ready.target.view !== 'containers' || !ready.target.selectedIdentity) return;
    const controller = new AbortController();
    let active = true;
    setStats(null);
    setStatsHistory([]);
    setStatsLoading(true);
    setStatsError('');
    void subscribeContainerStats(ready.target.selectedIdentity, ready.target.engine, ready.target.endpointID, (sample) => {
      if (!active) return;
      const normalized = normalizedStatsSample(sample);
      setStats(normalized);
      setStatsHistory((items) => mergeStatsSample(items, normalized));
      setStatsLoading(false);
      setStatsError('');
    }, controller.signal).catch((cause) => {
      if (!active || controller.signal.aborted) return;
      setStatsLoading(false);
      setStatsError(cause instanceof Error ? cause.message : String(cause));
    });
    onCleanup(() => {
      active = false;
      controller.abort();
    });
  });

  createEffect(() => {
    const ready = readyConsole();
    if (!ready || detailTab() !== 'logs' || ready.target.view !== 'containers' || !ready.target.selectedIdentity) return;
    const controller = new AbortController();
    let active = true;
    void tailContainerLogs(ready.target.selectedIdentity, ready.target.engine, ready.target.endpointID)
      .then((lines) => active && setLogs(lines))
      .catch(() => active && setLogs([]));
    void subscribeContainerLogs(ready.target.selectedIdentity, ready.target.engine, ready.target.endpointID, (line) => {
      if (!active) return;
      if (!logsPaused()) setLogs((items) => [...(items ?? []).slice(-1999), line]);
    }, controller.signal).catch(() => undefined);
    onCleanup(() => {
      active = false;
      controller.abort();
    });
  });

  createEffect(() => {
    const ready = readyConsole();
    if (!ready || detailTab() !== 'layers' || ready.target.view !== 'images' || !ready.target.selectedIdentity) return;
    let active = true;
    setImageHistory([]);
    setImageHistoryLoading(true);
    setImageHistoryError('');
    void getContainerImageHistory(ready.target.selectedIdentity, ready.target.engine, ready.target.endpointID)
      .then((history) => active && setImageHistory(history))
      .catch((cause) => {
        if (!active) return;
        setImageHistory([]);
        setImageHistoryError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => active && setImageHistoryLoading(false));
    onCleanup(() => { active = false; });
  });

  createEffect(() => {
    const ready = readyConsole();
    if (!ready || detailTab() !== 'files' || ready.target.view !== 'volumes' || !ready.target.selectedIdentity) return;
    if (!canAdmin()) return;
    if (!ready.endpoint.capabilities?.volume_files) return;
    let active = true;
    setFilesLoading(true);
    void listContainerResourceFiles('volumes', ready.target.selectedIdentity, filePath(), ready.target.engine, ready.target.endpointID)
      .then((listing) => active && setFileEntries([...listing.entries]))
      .catch(() => active && setFileEntries([]))
      .finally(() => active && setFilesLoading(false));
    onCleanup(() => { active = false; });
  });

  onMount(() => void loadOperations());
  onCleanup(() => {
    consoleLoadAbort?.abort();
    operationStreamAbort?.abort();
  });

  const setCurrentEngine = (next: ContainerEngine) => {
    if (engine() === next) return;
    void loadConsole(normalizeConsoleTarget({
      engine: next,
      endpointID: '',
      view: view(),
      selectedIdentity: '',
    }), { forceConnectionCheck: true, resetListControls: true });
  };

  const selectResource = (item: ContainerResourceInventoryItem) => {
    storedInventoryScrollTop = inventoryScrollElement?.scrollTop ?? 0;
    setSelectedIdentity(resourceIdentity(view(), item));
    setDetailTab('overview');
    setLogs(null);
    setStats(null);
    setRawInspect(null);
    setImageHistory([]);
    setImageHistoryError('');
    setFilePath('/');
    setFileEntries([]);
  };

  const closeDetails = () => {
    setSelectedIdentity('');
    queueMicrotask(() => {
      if (inventoryScrollElement) inventoryScrollElement.scrollTop = storedInventoryScrollTop;
    });
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

  const changeSort = (next: ResourceSortKey) => {
    if (sortKey() === next) {
      setSortDirection(sortDirection() === 'ascending' ? 'descending' : 'ascending');
      return;
    }
    setSortKey(next);
    setSortDirection('ascending');
  };

  const SortControl = (props: { sort: ResourceSortKey; label: string }) => (
    <button
      type="button"
      class="container-sort-control"
      aria-label={props.label}
      onClick={(event) => {
        event.stopPropagation();
        changeSort(props.sort);
      }}
    >
      <span>{props.label}</span>
      <Show when={sortKey() === props.sort}>
        {sortDirection() === 'ascending' ? <ArrowUp class="h-3 w-3" /> : <ArrowDown class="h-3 w-3" />}
      </Show>
    </button>
  );

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
    const generation = consoleLoadGeneration;
    setMutationBusy(true);
    try {
      const preflight = await preflightContainerOperation(draft.method, draft.request);
      if (generation !== consoleLoadGeneration) return;
      setReview({ request: draft.request, preflight });
      setPendingConfirmation(null);
      setConfirmation('');
    } catch (cause) {
      if (generation === consoleLoadGeneration) notify.error(i18n.t('containers.notifications.preflightFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === consoleLoadGeneration) setMutationBusy(false);
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
          void reloadConsole();
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

  const actionRequest = (method: string, target?: ContainerResourceInventoryItem | null): MutationDraft | null => {
    const item = target ?? selected();
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

  const runRowAction = (event: MouseEvent, item: ContainerResourceInventoryItem, method: string) => {
    event.stopPropagation();
    const request = actionRequest(method, item);
    if (request) beginMutation(request);
  };

  const runRowMenuAction = (item: ContainerResourceInventoryItem, method: string) => {
    const request = actionRequest(method, item);
    if (request) beginMutation(request);
  };

  const openImageRun = (event: MouseEvent, item: ContainerResourceInventoryItem) => {
    event.stopPropagation();
    const image = resourceIdentity('images', item);
    openCreation('container');
    setCreationImage(image);
  };

  const runSelectedImage = () => {
    const item = selected();
    if (!item) return;
    openCreation('container');
    setCreationImage(resourceIdentity('images', item));
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

  const loadRawInspect = async () => {
    const ready = readyConsole();
    if (!ready?.target.selectedIdentity || !canAdmin()) return;
    setRawInspectLoading(true);
    try {
      const value = await getRawContainerInspect(ready.target.selectedIdentity, ready.target.engine, ready.target.endpointID);
      if (readyConsole() === ready) setRawInspect(value);
    } catch (cause) {
      if (readyConsole() === ready) notify.error(i18n.t('containers.notifications.detailsFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (readyConsole() === ready) setRawInspectLoading(false);
    }
  };

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(filteredLogs().map((line) => line.message).join('\n'));
      notify.success(i18n.t('uiCopy.audit.copiedTitle'), i18n.t('uiCopy.audit.copiedMessage', { label: i18n.t('containers.inspector.logs') }));
    } catch {
      notify.error(i18n.t('uiCopy.audit.copyFailedTitle'), i18n.t('uiCopy.audit.copyFailedMessage'));
    }
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadLogs = () => {
    downloadBlob(new Blob([filteredLogs().map((line) => line.message).join('\n')], { type: 'text/plain;charset=utf-8' }), `${resourceName('containers', selected()!)}.log`);
  };

  const toggleLogFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void logViewElement?.requestFullscreen();
  };

  const openResourceFile = async (entry: ContainerResourceFileEntry, download = false) => {
    if (entry.kind === 'directory') {
      setFilePreview('');
      setFilePreviewName('');
      setFilePath(entry.path);
      return;
    }
    const ready = readyConsole();
    if (ready?.target.view !== 'volumes' || !ready.target.selectedIdentity) return;
    try {
      const blob = await readContainerResourceFile('volumes', ready.target.selectedIdentity, entry.path, ready.target.engine, ready.target.endpointID);
      if (readyConsole() !== ready) return;
      if (download) {
        downloadBlob(blob, entry.name);
        return;
      }
      const text = await blob.text();
      setFilePreviewName(entry.name);
      setFilePreview(text.includes('\u0000') ? '' : text);
    } catch (cause) {
      if (readyConsole() === ready) notify.error(i18n.t('containers.notifications.detailsFailedTitle'), cause instanceof Error ? cause.message : String(cause));
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
          <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('containers.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
        </>
      );
    }
    if (view() === 'images') return (
      <>
        <Button size="sm" onClick={runSelectedImage} disabled={!canRWX()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.run')}</Button>
        <Button size="sm" variant="outline" onClick={() => openCreation('image-tag')} disabled={!canRWX()}>{i18n.t('containers.actions.tag')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('images.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
      </>
    );
    if (view() === 'volumes') return <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('volumes.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>;
    if (view() === 'compose-projects') return (
      <>
        <Button size="sm" onClick={() => runAction('compose.projects.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('compose.projects.down')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.down')}</Button>
      </>
    );
    return (
      <>
        <Button size="sm" onClick={() => runAction('pods.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('pods.remove')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.remove')}</Button>
      </>
    );
  };

  const renderRowOverflow = (item: ContainerResourceInventoryItem) => {
    const operationDisabled = (method: string) => {
      if (method === 'containers.kill') return !canExecute() || !canAdmin();
      if (method === 'containers.remove' || method === 'images.remove' || method === 'volumes.remove' || method === 'compose.projects.down' || method === 'pods.remove') {
        return !canRWX() || !canAdmin();
      }
      return !canExecute();
    };
    const menuItem = (method: string, destructive = false): DropdownItem => ({
      id: method,
      label: operationLabel(method),
      disabled: operationDisabled(method),
      ...(destructive ? {
        icon: () => <Trash class="h-3.5 w-3.5 text-destructive" />,
      } : {}),
    });
    const items = (): DropdownItem[] => {
      if (view() === 'containers') return [
        menuItem('containers.restart'),
        menuItem((item as ContainerInventoryItem).state === 'paused' ? 'containers.unpause' : 'containers.pause'),
        menuItem('containers.kill', true),
        menuItem('containers.remove', true),
      ];
      if (view() === 'images') return [menuItem('images.remove', true)];
      if (view() === 'volumes') return [menuItem('volumes.remove', true)];
      if (view() === 'compose-projects') return [menuItem('compose.projects.restart'), menuItem('compose.projects.down', true)];
      return [menuItem('pods.restart'), menuItem('pods.remove', true)];
    };
    return (
      <div class="container-row-menu" onClick={(event) => event.stopPropagation()}>
        <Dropdown
          align="end"
          items={items()}
          onSelect={(method) => runRowMenuAction(item, method)}
          triggerAriaLabel={`${resourceName(view(), item)}: ${i18n.t('containers.detail.actions')}`}
          trigger={(
            <button type="button" class="container-icon-action inline-flex items-center justify-center" title={i18n.t('containers.detail.actions')}>
              <MoreVertical class="h-4 w-4" />
            </button>
          )}
        />
      </div>
    );
  };

  const statsForContainer = (item: ContainerInventoryItem): ContainerStats | undefined => {
    const direct = collectionStats().get(item.container_id);
    if (direct) return direct;
    return [...collectionStats().values()].find((sample) => item.container_id.startsWith(sample.container_id) || sample.container_id.startsWith(item.container_id));
  };

  const detailTabs = createMemo<DetailTab[]>(() => {
    if (view() === 'containers') {
      const tabs: DetailTab[] = ['overview', 'logs', 'inspect', 'mounts'];
      if (endpointStatus()?.capabilities?.exec) tabs.push('exec');
      tabs.push('stats');
      return tabs;
    }
    if (view() === 'images') return ['overview', 'layers', 'used-by'];
    if (view() === 'volumes') return endpointStatus()?.capabilities?.volume_files ? ['overview', 'files', 'used-by'] : ['overview', 'used-by'];
    return ['overview', 'containers'];
  });

  const detailTabLabel = (tab: DetailTab) => i18n.t(`containers.detailTabs.${tab}` as Parameters<typeof i18n.t>[0]);
  const resourceTabItems = createMemo<TabItem[]>(() => availableViews().map((item) => ({
    id: item,
    label: viewLabel(item),
    icon: <ViewIcon view={item} class="h-4 w-4" />,
    disabled: consoleState().phase !== 'ready' && !consoleState().endpoint?.available,
  })));
  const detailTabItems = createMemo<TabItem[]>(() => detailTabs().map((tab) => ({
    id: tab,
    label: detailTabLabel(tab),
  })));

  const selectResourceView = (nextView: ContainerResourceView) => {
    const state = consoleState();
    if ((!state.endpoint?.available && state.phase !== 'ready') || state.target.view === nextView) return;
    void loadConsole(
      { ...state.target, view: nextView, selectedIdentity: '' },
      { resetListControls: true },
    );
  };

  const renderReferences = () => {
    const record = selectedDetailRecord();
    const raw = detailArray(record, view() === 'compose-projects' || view() === 'pods' ? 'containers' : 'used_by');
    return (
      <div class="container-reference-list">
        <Show when={raw.length > 0} fallback={<div class="container-empty-inline">{i18n.t('containers.detail.emptyReferences')}</div>}>
          <For each={raw}>{(value) => {
            const reference = detailRecord(value);
            const identity = detailString(reference, 'container_id');
            return (
              <button type="button" class="container-reference-row" disabled={!identity} onClick={() => {
                if (!identity) return;
                const ready = readyConsole();
                if (!ready) return;
                void loadConsole(
                  { ...ready.target, view: 'containers', selectedIdentity: identity },
                  { resetListControls: true },
                );
              }}>
                <span class="container-status__dot" data-tone={resourceStatusTone(detailString(reference, 'state'))} />
                <span class="truncate">{detailString(reference, 'name') || identity.slice(0, 12)}</span>
                <span class="ml-auto text-xs text-muted-foreground">{localizedResourceStatus(detailString(reference, 'state'))}</span>
                <ChevronRight class="h-3.5 w-3.5" />
              </button>
            );
          }}</For>
        </Show>
      </div>
    );
  };

  const renderDetailContent = () => {
    const tab = detailTab();
    const record = selectedDetailRecord();
    if (tab === 'overview') return renderStructuredDetails();
    if (tab === 'logs') return (
      <div class="container-tool-view">
        <div class="container-tool-toolbar">
          <div class="container-search-control"><Search class="h-4 w-4" /><Input value={logQuery()} onInput={(event) => setLogQuery(event.currentTarget.value)} placeholder={i18n.t('containers.detail.searchLogs')} /></div>
          <Button size="sm" variant="ghost" class="container-icon-action" aria-label={logsPaused() ? i18n.t('containers.actions.resume') : i18n.t('containers.actions.pause')} title={logsPaused() ? i18n.t('containers.actions.resume') : i18n.t('containers.actions.pause')} onClick={() => setLogsPaused(!logsPaused())}>{logsPaused() ? <Play class="h-4 w-4" /> : <Pause class="h-4 w-4" />}</Button>
          <Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.wrap')} title={i18n.t('containers.detail.wrap')} aria-pressed={logsWrap()} onClick={() => setLogsWrap(!logsWrap())}><FileText class="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.copyLogs')} title={i18n.t('containers.detail.copyLogs')} onClick={() => void copyLogs()}><Copy class="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.downloadLogs')} title={i18n.t('containers.detail.downloadLogs')} onClick={downloadLogs}><Download class="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.fullscreen')} title={i18n.t('containers.detail.fullscreen')} onClick={toggleLogFullscreen}><Maximize class="h-4 w-4" /></Button>
        </div>
        <div ref={logViewElement} class="container-log-view" data-wrap={logsWrap() ? 'true' : 'false'}><Show when={logs()} fallback={i18n.t('containers.loading')}><For each={filteredLogs()}>{(line) => <div><Show when={line.timestamp_unix_ms}><time>{formatDate(line.timestamp_unix_ms)}</time></Show><span>{line.message}</span></div>}</For></Show></div>
      </div>
    );
    if (tab === 'inspect') return (
      <div class="container-inspect-view">
        <div class="container-inspect-heading"><div><strong>{i18n.t('containers.detail.safeInspect')}</strong><span>{i18n.t('containers.detail.safeInspectHint')}</span></div><Show when={canAdmin()}><Button size="sm" variant="outline" onClick={() => void loadRawInspect()} disabled={rawInspectLoading()}>{i18n.t('containers.detail.rawJson')}</Button></Show></div>
        <pre>{JSON.stringify(record, null, 2)}</pre>
        <Show when={rawInspect()}><div class="container-raw-warning"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.detail.rawWarning')}</div><pre data-container-raw-inspect>{JSON.stringify(rawInspect(), null, 2)}</pre></Show>
      </div>
    );
    if (tab === 'mounts') {
      const mounts = detailArray(detailRecord(record.runtime), 'mounts');
      return <div class="container-reference-list"><Show when={mounts.length > 0} fallback={<div class="container-empty-inline">{i18n.t('containers.detail.emptyMounts')}</div>}><For each={mounts}>{(value) => { const mount = detailRecord(value); return <div class="container-mount-row"><Database class="h-4 w-4" /><div><strong>{detailString(mount, 'target') || '—'}</strong><span>{detailString(mount, 'type')} · {detailString(mount, 'source_kind') || i18n.t('containers.detail.redacted')}</span></div></div>; }}</For></Show></div>;
    }
    if (tab === 'files') return (
      <div class="container-files-view">
        <div class="container-file-path"><Button size="sm" variant="ghost" class="container-icon-action" disabled={filePath() === '/'} aria-label={i18n.t('containers.detail.parentFolder')} onClick={() => setFilePath(filePath().split('/').slice(0, -1).join('/') || '/')}><ArrowLeft class="h-4 w-4" /></Button><span class="font-mono">{filePath()}</span></div>
        <Show when={canAdmin()} fallback={<div class="container-empty-inline">{i18n.t('containers.permissions.adminFiles')}</div>}>
          <Show when={!filesLoading()} fallback={<div class="container-empty-inline">{i18n.t('containers.loading')}</div>}>
            <div class="container-file-list"><For each={fileEntries()}>{(entry) => <div class="container-file-row"><button type="button" onClick={() => void openResourceFile(entry)}>{entry.kind === 'directory' ? <Folder class="h-4 w-4" /> : <FileText class="h-4 w-4" />}<span>{entry.name}</span></button><span>{formatBytes(entry.size_bytes)}</span><Show when={entry.kind === 'file'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.downloadFile')} onClick={() => void openResourceFile(entry, true)}><Download class="h-3.5 w-3.5" /></Button></Show></div>}</For></div>
          </Show>
        </Show>
        <Show when={filePreviewName()}><div class="container-file-preview"><div>{filePreviewName()}</div><pre>{filePreview() || i18n.t('containers.detail.binaryFile')}</pre></div></Show>
      </div>
    );
    if (tab === 'stats') {
      return <Show when={!statsError()} fallback={<div class="container-empty-inline"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t('containers.stats.refreshUnavailable')}</strong></div>}>
        <Show when={!statsLoading() || stats()} fallback={<div class="container-empty-inline"><Activity class="h-5 w-5" /><strong>{i18n.t('containers.stats.waiting')}</strong></div>}>
        <ContainerStatsDashboard
        history={statsHistory()}
        latest={stats()}
        cpuLabel={i18n.t('containers.stats.cpu')}
        memoryLabel={i18n.t('containers.stats.memory')}
        networkInLabel={i18n.t('containers.stats.networkIn')}
        networkOutLabel={i18n.t('containers.stats.networkOut')}
        />
        </Show>
      </Show>;
    }
    if (tab === 'layers') return <div class="container-layer-list"><Show when={!imageHistoryLoading()} fallback={<div class="container-empty-inline">{i18n.t('containers.loading')}</div>}><Show when={!imageHistoryError()} fallback={<div class="container-empty-inline"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t('containers.detail.layersUnavailable')}</strong></div>}><Show when={imageHistory().length > 0} fallback={<div class="container-empty-inline">{i18n.t('containers.detail.emptyLayers')}</div>}><For each={imageHistory()}>{(layer, index) => <div class="container-layer-row"><span>{index() + 1}</span><span class="font-mono">{layer.id?.slice(0, 18) || `${i18n.t('containers.detail.layer')} ${index() + 1}`}</span><span>{formatBytes(layer.size_bytes)}</span><span>{formatDate(layer.created_at_unix_ms)}</span></div>}</For></Show></Show></Show></div>;
    if (tab === 'used-by' || tab === 'containers') return renderReferences();
    return <div class="container-empty-inline"><Terminal class="h-5 w-5" />{i18n.t('containers.detail.execUnavailable')}</div>;
  };

  const renderInventoryToolbar = (pending = false): JSX.Element => (
    <section class="container-resource-toolbar" data-container-summary data-loading={pending ? 'true' : 'false'}>
      <div class="container-search-control">
        <Search class="h-4 w-4" aria-hidden="true" />
        <Input
          value={pending ? '' : searchQuery()}
          onInput={(event) => setSearchQuery(event.currentTarget.value)}
          aria-label={i18n.t('containers.search.label')}
          placeholder={i18n.t('containers.search.placeholder')}
          disabled={pending}
        />
        <Show when={!pending && searchQuery()}><button type="button" class="container-search-clear" onClick={() => setSearchQuery('')} aria-label={i18n.t('containers.search.clear')}><X class="h-3.5 w-3.5" /></button></Show>
      </div>
      <div class="container-filter-switch" role="group" aria-label={i18n.t('containers.filters.label')}>
        <button type="button" aria-pressed={resourceFilter() === 'all'} onClick={() => setResourceFilter('all')} disabled={pending}>{filterLabel('all')}</button>
        <button type="button" aria-pressed={resourceFilter() === 'active'} onClick={() => setResourceFilter('active')} disabled={pending}>{filterLabel('active')}</button>
        <button type="button" aria-pressed={resourceFilter() === 'inactive'} onClick={() => setResourceFilter('inactive')} disabled={pending}>{filterLabel('inactive')}</button>
        <Show when={!pending && managedResourceCount() > 0}><button type="button" aria-pressed={resourceFilter() === 'managed'} onClick={() => setResourceFilter('managed')}><Layers class="h-3.5 w-3.5" /><span>{managedResourceCount()}</span><span class="sr-only">{filterLabel('managed')}</span></button></Show>
      </div>
      <div class="container-toolbar-actions">
        <div class="container-column-picker">
          <Dropdown
            align="end"
            disabled={pending}
            items={[
              {
                id: 'secondary',
                label: secondaryColumnLabel(),
                keepOpen: true,
                icon: () => showSecondaryColumn() ? <Check class="h-3.5 w-3.5" /> : <span class="h-3.5 w-3.5" />,
              },
              view() === 'containers'
                ? {
                    id: 'ports',
                    label: i18n.t('containers.detail.ports'),
                    keepOpen: true,
                    icon: () => showPortsColumn() ? <Check class="h-3.5 w-3.5" /> : <span class="h-3.5 w-3.5" />,
                  }
                : {
                    id: 'created',
                    label: i18n.t('containers.columns.created'),
                    keepOpen: true,
                    icon: () => showCreatedColumn() ? <Check class="h-3.5 w-3.5" /> : <span class="h-3.5 w-3.5" />,
                  },
            ]}
            onSelect={(column) => {
              if (column === 'secondary') setShowSecondaryColumn((visible) => !visible);
              if (column === 'ports') setShowPortsColumn((visible) => !visible);
              if (column === 'created') setShowCreatedColumn((visible) => !visible);
            }}
            triggerAriaLabel={i18n.t('containers.columns.settings')}
            trigger={(
              <button type="button" class="container-icon-action inline-flex items-center justify-center" title={i18n.t('containers.columns.settings')}>
                <Settings class="h-4 w-4" />
              </button>
            )}
          />
        </div>
        <Show when={view() === 'containers' && (pending || endpointStatus()?.capabilities?.collection_stats)}><Button size="sm" variant="ghost" onClick={() => setChartsOpen(!chartsOpen())} aria-pressed={!pending && chartsOpen()} disabled={pending}><Activity class="mr-1.5 h-3.5 w-3.5" />{chartsOpen() ? i18n.t('containers.detail.hideCharts') : i18n.t('containers.detail.showCharts')}</Button></Show>
        <Show when={view() === 'images' || view() === 'volumes'}><Button size="sm" variant="ghost" onClick={prune} disabled={pending || !canRWX() || !canAdmin()}>{i18n.t('containers.actions.prune')}</Button></Show>
        <Show when={view() === 'containers'}><Button size="sm" onClick={() => openCreation('container')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.container')}</Button></Show>
        <Show when={view() === 'images'}><Button size="sm" onClick={() => openCreation('image')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.image')}</Button></Show>
        <Show when={view() === 'volumes'}><Button size="sm" onClick={() => openCreation('volume')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.volume')}</Button></Show>
        <Show when={view() === 'pods'}><Button size="sm" onClick={() => openCreation('pod')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.pod')}</Button></Show>
      </div>
    </section>
  );

  const renderInventoryTableHeader = (pending = false): JSX.Element => (
    <thead><tr>
      <th aria-sort={pending ? 'none' : sortKey() === 'status' ? sortDirection() : 'none'}><Show when={!pending} fallback={<span class="container-sort-control">{i18n.t('containers.columns.status')}</span>}><SortControl sort="status" label={i18n.t('containers.columns.status')} /></Show></th>
      <th aria-sort={pending ? 'none' : sortKey() === 'name' ? sortDirection() : 'none'}><Show when={!pending} fallback={<span class="container-sort-control">{i18n.t('containers.columns.name')}</span>}><SortControl sort="name" label={i18n.t('containers.columns.name')} /></Show></th>
      <Show when={showSecondaryColumn()}><th aria-sort={pending ? 'none' : sortKey() === 'secondary' ? sortDirection() : 'none'}><Show when={!pending} fallback={<span class="container-sort-control">{secondaryColumnLabel()}</span>}><SortControl sort="secondary" label={secondaryColumnLabel()} /></Show></th></Show>
      <Show when={view() === 'containers'}><Show when={showPortsColumn()}><th>{i18n.t('containers.detail.ports')}</th></Show><Show when={chartsOpen()}><th>{i18n.t('containers.stats.cpu')}</th><th>{i18n.t('containers.stats.memory')}</th></Show></Show>
      <Show when={view() !== 'containers' && showCreatedColumn()}><th aria-sort={pending ? 'none' : sortKey() === 'created' ? sortDirection() : 'none'}><Show when={!pending} fallback={<span class="container-sort-control">{i18n.t('containers.columns.created')}</span>}><SortControl sort="created" label={i18n.t('containers.columns.created')} /></Show></th></Show>
      <th class="container-actions-column">{i18n.t('containers.detail.actions')}</th>
    </tr></thead>
  );

  const renderInventorySkeleton = (): JSX.Element => (
    <>
      <div class="container-resource-table-shell container-resource-table-shell--loading" data-container-resource-skeleton-table>
        <table class="w-full text-left text-sm">
          {renderInventoryTableHeader(true)}
          <tbody><For each={[0, 1, 2, 3, 4]}>{(row) => <tr data-container-skeleton-row aria-hidden="true">
            <td><span class={`container-skeleton ${view() === 'images' || view() === 'volumes' ? 'container-skeleton--dot' : 'container-skeleton--status'}`} /></td>
            <td><div class="container-name-cell"><span class="container-skeleton container-skeleton--resource-icon" /><span class="container-skeleton container-skeleton--name" data-row={row % 3} /></div></td>
            <Show when={showSecondaryColumn()}><td><span class="container-skeleton container-skeleton--secondary" data-row={row % 2} /></td></Show>
            <Show when={view() === 'containers'}><Show when={showPortsColumn()}><td><span class="container-skeleton container-skeleton--port" data-row={row % 2} /></td></Show><Show when={chartsOpen()}><td><span class="container-skeleton container-skeleton--metric" /></td><td><span class="container-skeleton container-skeleton--metric" /></td></Show></Show>
            <Show when={view() !== 'containers' && showCreatedColumn()}><td><span class="container-skeleton container-skeleton--created" /></td></Show>
            <td><div class="container-row-actions"><span class="container-skeleton container-skeleton--action" /><span class="container-skeleton container-skeleton--action" /><span class="container-skeleton container-skeleton--chevron" /></div></td>
          </tr>}</For></tbody>
        </table>
      </div>
      <div class="container-mobile-list container-mobile-list--loading" data-container-mobile-skeleton aria-hidden="true">
        <For each={[0, 1, 2, 3, 4]}>{(row) => <div class="container-mobile-card">
          <span class="container-skeleton container-skeleton--resource-icon" />
          <span class="container-mobile-skeleton-copy"><span class="container-skeleton container-skeleton--name" data-row={row % 3} /><span class="container-skeleton container-skeleton--mobile-secondary" /></span>
          <span class="container-skeleton container-skeleton--mobile-status" />
          <span class="container-skeleton container-skeleton--chevron" />
        </div>}</For>
      </div>
    </>
  );

  const renderConsoleFallback = () => {
    const state = consoleState();
    if (state.phase === 'loading') {
      return (
        <div class="container-list-page" data-container-list-loading aria-label={i18n.t('containers.loading')}>
          {renderInventoryToolbar(true)}
          <div class="container-inventory-scroll">
            {renderInventorySkeleton()}
          </div>
        </div>
      );
    }
    const permission = state.phase === 'permission';
    const message = state.phase === 'error'
      ? state.message
      : i18n.t(permission ? 'containers.engineState.permissionDescription' : 'containers.engineState.unavailableDescription', { engine: state.target.engine });
    return (
      <div class="container-engine-state" data-container-engine-state={state.phase} role={state.phase === 'error' ? 'alert' : 'status'}>
        <div class="container-empty-state__mark">{permission || state.phase === 'error' ? <AlertTriangle class="h-6 w-6" /> : <Layers class="h-6 w-6" />}</div>
        <span>{state.target.engine}</span>
        <strong>{i18n.t(permission ? 'containers.engineState.permissionTitle' : 'containers.engineState.unavailableTitle', { engine: state.target.engine })}</strong>
        <p>{message}</p>
        <Button size="sm" variant="outline" onClick={() => void reloadConsole(true)}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.engineState.retry')}</Button>
      </div>
    );
  };

  return (
    <div class={`redeven-containers flex h-full min-h-0 flex-col ${redevenSurfaceRoleClass('main')}`} data-container-page data-variant={props.variant ?? 'activity'}>
      <header class="container-command-header shrink-0 px-3 md:px-5">
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
            <Show when={endpointStatus()} fallback={<Show when={loading()}><div class="container-endpoint-control container-endpoint-control--loading" aria-hidden="true"><span class="container-skeleton container-skeleton--endpoint-status" /><span class="container-skeleton container-skeleton--endpoint" /></div></Show>}><div class="container-endpoint-control min-w-0">
              <span class="container-endpoint-status" data-available={endpointStatus()?.available ? 'true' : 'false'} aria-hidden="true" />
              <label class="sr-only" for={`container-endpoint-${props.stateScope ?? 'activity'}`}>{i18n.t('containers.endpoint')}</label>
              <select
                id={`container-endpoint-${props.stateScope ?? 'activity'}`}
                class="container-touch-target min-w-0 flex-1 bg-transparent px-2 text-sm font-medium outline-none"
                title={`${endpointStatus()?.remote ? i18n.t('containers.endpointMeta.remote') : i18n.t('containers.endpointMeta.local')} · ${endpointStatus()?.engine_version ?? ''}`}
                value={endpointID()}
                disabled={consoleBusy()}
                onChange={(event) => void loadConsole(
                  { ...consoleState().target, endpointID: event.currentTarget.value, selectedIdentity: '' },
                  { forceConnectionCheck: true, resetListControls: true },
                )}
              >
                <For each={endpoints()}>{(endpoint) => <option value={endpoint.endpoint_id}>{endpoint.display_name}</option>}</For>
              </select>
              <span class="sr-only" role="status">{endpointStatus()?.available ? i18n.t('containers.status.connected') : i18n.t('containers.status.unavailable')}</span>
            </div></Show>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => void reloadConsole(true)} disabled={consoleBusy()} aria-label={i18n.t('containers.actions.refresh')} title={i18n.t('containers.actions.refresh')}><Refresh class={`h-4 w-4 ${consoleBusy() ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => setOperationsOpen(true)} aria-label={i18n.t('containers.operations.title')} title={i18n.t('containers.operations.title')}>
              <Activity class="h-4 w-4" aria-hidden="true" />
              <Show when={activeOperationCount() > 0}><span class="container-operation-count">{activeOperationCount()}</span></Show>
            </Button>
          </div>
        </div>

        <Tabs
          class="container-resource-tabs"
          items={resourceTabItems()}
          activeId={view()}
          onChange={(id) => selectResourceView(id as ContainerResourceView)}
          size="md"
          ariaLabel={i18n.t('containers.resourceNavigation')}
          features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false, scrollButtons: 'auto' }}
          slotClassNames={{ scrollContainer: 'container-resource-tabs__scroller', tab: 'container-resource-tabs__tab' }}
        />
      </header>

      <main class="container-content min-h-0 flex-1 overflow-hidden" aria-busy={consoleBusy()}>
        <Show when={readyConsole()} fallback={renderConsoleFallback()}>
        <Show when={selected()} keyed fallback={
          <div class="container-list-page">
            {renderInventoryToolbar()}
            <Show when={chartsOpen() && view() === 'containers'}><div class="container-metrics-strip"><div><span>{i18n.t('containers.stats.cpu')}</span><strong>{[...collectionStats().values()].reduce((sum, item) => sum + item.cpu_percent, 0).toFixed(1)}%</strong></div><div><span>{i18n.t('containers.stats.memory')}</span><strong>{formatBytes([...collectionStats().values()].reduce((sum, item) => sum + item.memory_bytes, 0))}</strong></div><div><span>{i18n.t('containers.filters.active')}</span><strong>{activeResourceCount()}</strong></div></div></Show>
            <div class="container-inventory-scroll" ref={(element) => { inventoryScrollElement = element; }}>
              <Show when={filteredInventory().length > 0} fallback={<div class="container-empty-state"><Search class="h-6 w-6" /><strong>{inventory().length ? i18n.t('containers.empty.filteredTitle') : i18n.t('containers.empty.title')}</strong></div>}>
                  <div class="container-resource-table-shell" data-container-table-shell><table class="w-full text-left text-sm" data-container-resource-table>{renderInventoryTableHeader()}<tbody><For each={filteredInventory()}>{(item, index) => {
                    const container = () => item as ContainerInventoryItem;
                    const sample = () => view() === 'containers' ? statsForContainer(container()) : undefined;
                    return <tr tabindex={0} data-container-resource-row-index={index()} onClick={() => selectResource(item)} onKeyDown={(event) => handleTableKey(event, index())}><td><Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), item))}><span class="container-usage-dot" data-active={resourceActive(view(), item)} /></Show></td><td><div class="container-name-cell"><ViewIcon view={view()} class="h-4 w-4" /><span class="truncate">{resourceName(view(), item)}</span><Show when={resourceManagement(item)?.managed}><span class="container-managed-label" title={i18n.t('containers.managed.badge')}><Layers class="h-3.5 w-3.5" /></span></Show></div></td><Show when={showSecondaryColumn()}><td class="container-secondary-cell"><Show when={view() === 'containers'}>{container().image?.reference || '—'}</Show><Show when={view() === 'images'}>{formatBytes((item as ImageInventoryItem).size_bytes)}</Show><Show when={view() === 'volumes'}>{(item as VolumeInventoryItem).driver || '—'}</Show><Show when={view() === 'compose-projects' || view() === 'pods'}>{(item as ComposeProjectInventoryItem | PodInventoryItem).running_count} / {(item as ComposeProjectInventoryItem | PodInventoryItem).container_count}</Show></td></Show><Show when={view() === 'containers'}><Show when={showPortsColumn()}><td class="container-port-cell">{container().ports?.map(formatPort).filter(Boolean).slice(0, 2).join(', ') || '—'}</td></Show><Show when={chartsOpen()}><td class="tabular-nums">{sample() ? `${sample()!.cpu_percent.toFixed(1)}%` : '—'}</td><td class="tabular-nums">{formatBytes(sample()?.memory_bytes)}</td></Show></Show><Show when={view() !== 'containers' && showCreatedColumn()}><td>{formatDate((item as ImageInventoryItem | VolumeInventoryItem | PodInventoryItem).created_at_unix_ms)}</td></Show><td><div class="container-row-actions"><Show when={resourceManagement(item)?.managed} fallback={<><Show when={view() === 'containers'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={resourceActive(view(), item) ? i18n.t('containers.actions.stop') : i18n.t('containers.actions.start')} disabled={!canExecute()} onClick={(event) => runRowAction(event, item, resourceActive(view(), item) ? 'containers.stop' : 'containers.start')}>{resourceActive(view(), item) ? <Stop class="h-4 w-4" /> : <Play class="h-4 w-4" />}</Button></Show><Show when={view() === 'images'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.actions.run')} disabled={!canRWX()} onClick={(event) => openImageRun(event, item)}><Play class="h-4 w-4" /></Button></Show><Show when={view() === 'compose-projects'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={resourceActive(view(), item) ? i18n.t('containers.actions.stop') : i18n.t('containers.actions.start')} disabled={!canExecute()} onClick={(event) => runRowAction(event, item, resourceActive(view(), item) ? 'compose.projects.stop' : 'compose.projects.start')}>{resourceActive(view(), item) ? <Stop class="h-4 w-4" /> : <Play class="h-4 w-4" />}</Button></Show><Show when={view() === 'pods'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={resourceActive(view(), item) ? i18n.t('containers.actions.stop') : i18n.t('containers.actions.start')} disabled={!canExecute()} onClick={(event) => runRowAction(event, item, resourceActive(view(), item) ? 'pods.stop' : 'pods.start')}>{resourceActive(view(), item) ? <Stop class="h-4 w-4" /> : <Play class="h-4 w-4" />}</Button></Show>{renderRowOverflow(item)}<ChevronRight class="h-4 w-4 text-muted-foreground" /></>}><Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); selectResource(item); queueMicrotask(openManagedService); }}><ExternalLink class="h-4 w-4" /></Button></Show></div></td></tr>;
                  }}</For></tbody></table></div>
                  <div class="container-mobile-list" data-container-mobile-list><For each={filteredInventory()}>{(item) => <button type="button" class="container-mobile-card" onClick={() => selectResource(item)}><span class="container-resource-icon" data-tone={resourceStatusTone(resourceStatus(view(), item))}><ViewIcon view={view()} class="h-4 w-4" /></span><span class="min-w-0 flex-1"><strong>{resourceName(view(), item)}</strong><small>{view() === 'containers' ? (item as ContainerInventoryItem).image?.reference || '—' : secondaryColumnLabel()}</small></span><Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), item))}><span class="text-xs">{Number(resourceStatus(view(), item))}</span></Show><ChevronRight class="h-4 w-4" /></button>}</For></div>
              </Show>
            </div>
          </div>
        }>{(item) => <article class="container-detail-page" data-container-detail-page><div class="container-detail-header"><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.back')} onClick={closeDetails}><ArrowLeft class="h-4 w-4" /></Button><div class="container-resource-icon container-resource-icon--large" data-tone={resourceStatusTone(resourceStatus(view(), item))}><ViewIcon view={view()} class="h-4 w-4" /></div><div class="container-detail-identity"><span>{viewLabel(view())}</span><h2>{resourceName(view(), item)}</h2><small>{resourceIdentity(view(), item).slice(0, 24)}</small></div><Show when={view() !== 'images' && view() !== 'volumes'}>{renderStatus(resourceStatus(view(), item))}</Show><div class="container-detail-actions"><Show when={selectedManagedOwner()} keyed>{(owner) => <Button size="sm" variant="outline" onClick={openManagedService}><ExternalLink class="mr-1.5 h-3.5 w-3.5" />{owner.name}</Button>}</Show><Show when={!selectedManagedOwner()}>{renderResourceActions()}</Show></div></div><Tabs class="container-detail-tabs" items={detailTabItems()} activeId={detailTab()} onChange={(id) => setDetailTab(id as DetailTab)} size="md" ariaLabel={viewLabel(view())} features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false, scrollButtons: 'auto' }} slotClassNames={{ scrollContainer: 'container-detail-tabs__scroller', tab: 'container-detail-tabs__tab' }} /><div class="container-detail-body">{renderDetailContent()}</div></article>}</Show>
        </Show>
      </main>

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

function ContainerStatsDashboard(props: {
  history: readonly ContainerStats[];
  latest: ContainerStats | null;
  cpuLabel: string;
  memoryLabel: string;
  networkInLabel: string;
  networkOutLabel: string;
}) {
  const samples = createMemo(() => props.history.length > 0 ? props.history : (props.latest ? [props.latest] : []));
  const latest = createMemo(() => samples().at(-1) ?? props.latest);
  const labels = createMemo(() => samples().map((sample) => chartTimeLabel(sample.sampled_at_unix_ms)));
  const cpuValues = createMemo(() => samples().map((sample) => Math.max(0, Number(sample.cpu_percent) || 0)));
  const cpuMaximum = createMemo(() => cpuScaleMaximum(cpuValues()));
  const memoryLimit = createMemo(() => Number(latest()?.memory_limit ?? 0));
  const memoryValues = createMemo(() => {
    const limit = memoryLimit();
    return samples().map((sample) => limit > 0 ? clampPercent((sample.memory_bytes / limit) * 100) : Math.max(0, sample.memory_bytes));
  });
  const networkInValues = createMemo(() => networkRateSeries(samples(), 'network_rx_bytes'));
  const networkOutValues = createMemo(() => networkRateSeries(samples(), 'network_tx_bytes'));
  const latestNetworkIn = createMemo(() => networkInValues().at(-1) ?? 0);
  const latestNetworkOut = createMemo(() => networkOutValues().at(-1) ?? 0);
  const memoryPercent = createMemo(() => {
    const limit = memoryLimit();
    return limit > 0 ? clampPercent((Number(latest()?.memory_bytes ?? 0) / limit) * 100) : 0;
  });

  return (
    <div class="container-stats-dashboard" data-container-stats-dashboard>
      <div class="container-monitor-panel" data-container-monitor-panel data-container-cpu-panel><Panel class="overflow-hidden">
        <PanelContent class="space-y-2 p-3">
        <div class="container-monitor-heading">
          <span>{props.cpuLabel}</span>
          <strong>{formatPercent(latest()?.cpu_percent)}</strong>
        </div>
        <MonitoringChart
          class="container-monitor-chart"
          series={[{ name: props.cpuLabel, data: cpuValues(), color: 'var(--redeven-runtime-monitor-cpu-line)' }]}
          labels={labels()}
          height={140}
          maxPoints={60}
          showGrid
          showLegend={false}
          smooth={false}
          yMin={0}
          yMax={cpuMaximum()}
          formatYTick={(value) => `${Number(value.toFixed(1))}%`}
          formatTooltipValue={(value) => formatPercent(value)}
          maxXAxisLabels={5}
        />
        </PanelContent>
      </Panel></div>

      <div class="container-monitor-panel" data-container-monitor-panel data-container-memory-panel><Panel class="overflow-hidden">
        <PanelContent class="space-y-2 p-3">
        <div class="container-monitor-heading">
          <span>{props.memoryLabel}</span>
          <strong>{formatBytes(latest()?.memory_bytes)}<Show when={memoryLimit() > 0}><small> / {formatBytes(memoryLimit())} · {formatPercent(memoryPercent())}</small></Show></strong>
        </div>
        <MonitoringChart
          class="container-monitor-chart"
          series={[{ name: props.memoryLabel, data: memoryValues(), color: 'var(--redeven-runtime-monitor-memory-line)' }]}
          labels={labels()}
          height={140}
          maxPoints={60}
          showGrid
          showLegend={false}
          smooth={false}
          yMin={0}
          yMax={memoryLimit() > 0 ? utilizationScaleMaximum(memoryValues()) : undefined}
          formatYTick={(value) => memoryLimit() > 0 ? `${Number(value.toFixed(1))}%` : formatBytes(value)}
          formatTooltipValue={(value, context) => {
            const sample = samples()[context.pointIndex];
            return memoryLimit() > 0 && sample
              ? `${formatBytes(sample.memory_bytes)} · ${formatPercent(value)}`
              : formatBytes(value);
          }}
          maxXAxisLabels={5}
        />
        </PanelContent>
      </Panel></div>

      <div class="container-monitor-panel container-monitor-panel--network" data-container-monitor-panel data-container-network-panel><Panel class="overflow-hidden">
        <PanelContent class="space-y-2 p-3">
        <div class="container-monitor-heading container-monitor-heading--network">
          <div class="container-network-reading" data-direction="in">
            <span><ArrowDown class="h-3.5 w-3.5" aria-hidden="true" />{props.networkInLabel}</span>
            <strong>{formatByteRate(latestNetworkIn())}</strong>
          </div>
          <div class="container-network-reading" data-direction="out">
            <span><ArrowUp class="h-3.5 w-3.5" aria-hidden="true" />{props.networkOutLabel}</span>
            <strong>{formatByteRate(latestNetworkOut())}</strong>
          </div>
        </div>
        <MonitoringChart
          class="container-monitor-chart"
          series={[
            { name: props.networkInLabel, data: networkInValues(), color: 'var(--redeven-runtime-monitor-download-line)' },
            { name: props.networkOutLabel, data: networkOutValues(), color: 'var(--redeven-runtime-monitor-upload-line)' },
          ]}
          labels={labels()}
          height={140}
          maxPoints={60}
          showGrid
          showLegend
          smooth={false}
          yMin={0}
          formatYTick={(value) => formatByteRate(value)}
          formatTooltipValue={(value) => formatByteRate(value)}
          maxXAxisLabels={8}
        />
        </PanelContent>
      </Panel></div>
    </div>
  );
}
