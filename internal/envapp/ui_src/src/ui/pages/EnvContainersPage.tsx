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
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  Folder,
  FileText,
  Info,
  Layers,
  Lock,
  Maximize,
  MoreVertical,
  Package,
  Pause,
  Play,
  Plus,
  Refresh,
  Search,
  Settings,
  StopFilled,
  Terminal,
  Trash,
  X,
  XCircle,
} from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { Button, DirectoryPicker, Dropdown, FileOpenPicker, Input, MonitoringChart, Select, Tabs, Tag, type DropdownItem, type TabItem } from '@floegence/floe-webapp-core/ui';

import { REDEVEN_ENV_APP_BASE_PATH } from '../../build/envAppBasePath';
import { Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import {
  cancelContainerOperation,
  createContainerExecSession,
  createComposeProjectDefinition,
  createContainerOperation,
  deleteContainerExecSession,
  deleteComposeProjectDefinition,
  getComposeProjectDefinition,
  getContainerImageHistory,
  getContainerServiceConfiguration,
  getRawContainerInspect,
  getContainerResourceDetails,
  listContainerOperations,
  listContainerServices,
  listContainerOperationEvents,
  listContainerResources,
  listContainerRuntimes,
  listContainerResourceFiles,
  readContainerResourceFile,
  preflightContainerOperation,
  subscribeContainerOperation,
  subscribeContainerOperationEvents,
  subscribeContainerLogs,
  subscribeContainerStats,
  subscribeContainerStatsCollection,
  tailContainerLogs,
  updateComposeProjectDefinition,
  type ComposeProjectInventoryItem,
  type ContainerEngine,
  type ContainerInventoryItem,
  type ContainerLogLine,
  type ContainerOperation,
  type ContainerOperationEvent,
  type ContainerPreflight,
  type ContainerResourceInventoryItem,
  type ContainerResourceView,
  type ContainerStats,
  type ContainerRuntime,
  type ContainerRuntimeState,
  type ContainerService,
  type ContainerServiceConfiguration,
  type ContainerServiceConfigurationSource,
  type ContainerServiceConfigurationSourceID,
  type ContainerImageHistoryEntry,
  type ReadyContainerRuntime,
  type ContainerResourceFileEntry,
  type ImageInventoryItem,
  type PodInventoryItem,
  type VolumeInventoryItem,
} from '../services/containerResourcesApi';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { LocalApiError } from '../services/localApi';
import { consumeContainerResourceNavigation, subscribeContainerResourceNavigation, type ContainerResourceNavigation } from '../services/containerResourceNavigation';
import { useI18n } from '../i18n';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { createFilesystemPickerDataSource } from '../../../../../flower_ui/src/filePicker/createFilesystemPickerDataSource';
import { useEnvContext } from './EnvContext';
import { ContainerExecTerminal } from '../widgets/ContainerExecTerminal';
import { TextFilePreviewPane } from '../widgets/TextFilePreviewPane';
import './env-containers.css';

type PersistedContainersState = Readonly<{
  version: 2;
  view: ContainerResourceView;
  selectedResourceKey: string;
}>;

type CreationMode = 'image' | 'volume' | 'pod' | 'image-tag';

type ContainerRunArgument = Readonly<{ id: string; value: string }>;
type ContainerRunKeyValue = Readonly<{ id: string; key: string; value: string; revealed?: boolean }>;
type ContainerRunPort = Readonly<{
  id: string;
  containerPort: string;
  hostPort: string;
  hostIP: string;
  protocol: 'tcp' | 'udp' | 'sctp';
}>;
type ContainerRunMount = Readonly<{
  id: string;
  type: 'bind' | 'volume' | 'tmpfs';
  source: string;
  target: string;
  readOnly: boolean;
  tmpfsSizeMiB: string;
  noexec: boolean;
  nosuid: boolean;
  nodev: boolean;
}>;
type ContainerRunDevice = Readonly<{
  id: string;
  hostPath: string;
  containerPath: string;
  permissions: string;
}>;
type ContainerRunDraft = Readonly<{
  targetKey: string;
  image: string;
  name: string;
  entrypoint: string;
  arguments: readonly ContainerRunArgument[];
  ports: readonly ContainerRunPort[];
  mounts: readonly ContainerRunMount[];
  environment: readonly ContainerRunKeyValue[];
  cpuCount: string;
  memory: string;
  memoryUnit: 'MiB' | 'GiB';
  networkMode: string;
  restartPolicy: string;
  user: string;
  readOnlyRoot: boolean;
  privileged: boolean;
  pidMode: string;
  ipcMode: string;
  pidsLimit: string;
  shmSize: string;
  shmUnit: 'MiB' | 'GiB';
  labels: readonly ContainerRunKeyValue[];
  capAdd: readonly ContainerRunArgument[];
  capDrop: readonly ContainerRunArgument[];
  securityOptions: readonly ContainerRunArgument[];
  devices: readonly ContainerRunDevice[];
}>;

type ContainerPathPickerTarget = Readonly<{
  kind: 'file' | 'directory';
  owner: 'mount' | 'device';
  id: string;
}>;

type MutationDraft = Readonly<{
  method: string;
  request: Record<string, unknown>;
  confirmationLabel?: string;
  confirmationValue?: string;
}>;

type ContainerServiceConfigurationDraft = Readonly<{
  content: string;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  revealHTTPProxy: boolean;
  revealHTTPSProxy: boolean;
}>;

type ContainerServiceConfigurationSection = 'general' | 'proxy' | 'credentials' | 'advanced';
type DockerCLIConfigurationDocument = Record<string, unknown>;
const dockerCLIOutputFormats = [
  { key: 'psFormat', command: 'docker ps' },
  { key: 'imagesFormat', command: 'docker images' },
  { key: 'networksFormat', command: 'docker network ls' },
  { key: 'pluginsFormat', command: 'docker plugin ls' },
  { key: 'statsFormat', command: 'docker stats' },
  { key: 'servicesFormat', command: 'docker service ls' },
  { key: 'tasksFormat', command: 'docker service ps' },
  { key: 'secretFormat', command: 'docker secret ls' },
  { key: 'configFormat', command: 'docker config ls' },
  { key: 'nodeFormat', command: 'docker node ls' },
] as const;

type ReviewState = Readonly<{
  request: Record<string, unknown>;
  preflight: ContainerPreflight;
}>;

type ResourceFilter = 'all' | 'active' | 'inactive' | 'managed';
type DetailTab = 'overview' | 'logs' | 'inspect' | 'mounts' | 'exec' | 'files' | 'stats' | 'layers' | 'used-by' | 'containers';
type ResourceSortKey = 'status' | 'name' | 'secondary' | 'created';
type ResourceSortDirection = 'ascending' | 'descending';

type DetailRecord = Readonly<Record<string, unknown>>;

const jsonObject = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const parseDockerCLIConfiguration = (value: string): DockerCLIConfigurationDocument | null => {
  try {
    return jsonObject(JSON.parse(value)) as DockerCLIConfigurationDocument | null;
  } catch {
    return null;
  }
};

const dockerCLIString = (document: DockerCLIConfigurationDocument | null, key: string): string => (
  typeof document?.[key] === 'string' ? document[key] as string : ''
);

const objectWithString = (value: unknown, key: string, next: string): Record<string, unknown> => {
  const document = { ...(jsonObject(value) ?? {}) };
  if (next === '') delete document[key];
  else document[key] = next;
  return document;
};

type ContainerConsoleTarget = Readonly<{
  view: ContainerResourceView;
  selectedResourceKey: string;
}>;

type ContainerResourceEntry = Readonly<{
  key: string;
  target: ReadyContainerRuntime;
  item: ContainerResourceInventoryItem;
}>;

type ContainerConsoleState =
  | Readonly<{ phase: 'loading'; target: ContainerConsoleTarget; runtimes: readonly ContainerRuntime[] }>
  | Readonly<{ phase: 'ready'; target: ContainerConsoleTarget; runtimes: readonly ContainerRuntime[]; inventory: readonly ContainerResourceEntry[]; refreshing: boolean }>
  | Readonly<{ phase: 'unavailable' | 'permission'; target: ContainerConsoleTarget; runtimes: readonly ContainerRuntime[] }>
  | Readonly<{ phase: 'error'; target: ContainerConsoleTarget; runtimes: readonly ContainerRuntime[]; message: string }>;

type ReadyContainerConsoleState = Extract<ContainerConsoleState, { phase: 'ready' }>;

type RelatedNavigationOrigin = Readonly<{
  state: ReadyContainerConsoleState;
  detailTab: DetailTab;
  scrollTop: number;
}>;

const DEFAULT_STATE: PersistedContainersState = {
  version: 2,
  view: 'containers',
  selectedResourceKey: '',
};

const TERMINAL_OPERATION_STATES = new Set(['succeeded', 'failed', 'canceled', 'interrupted']);
const LOCALIZED_RESOURCE_STATES = new Set([
  'running', 'stopped', 'exited', 'paused', 'restarting', 'created', 'removing',
  'dead', 'healthy', 'unhealthy', 'degraded', 'partial', 'unknown',
]);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
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

function containerRunSuggestedPorts(value: unknown): readonly ContainerRunPort[] {
  const record = detailRecord(value);
  return detailArray(record, 'exposed_ports').flatMap((entry) => {
    const [portValue, protocolValue = 'tcp'] = compact(entry).toLowerCase().split('/', 2);
    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !['tcp', 'udp', 'sctp'].includes(protocolValue)) return [];
    return [{ ...emptyContainerRunPort(), containerPort: String(port), protocol: protocolValue as ContainerRunPort['protocol'] }];
  });
}

function sanitizePersistedState(value: unknown): PersistedContainersState {
  const candidate = value as Partial<PersistedContainersState> | null;
  if (candidate?.version !== 2) return DEFAULT_STATE;
  const views: readonly ContainerResourceView[] = ['containers', 'images', 'volumes', 'compose-projects', 'pods'];
  const view = views.includes(candidate.view as ContainerResourceView)
    ? candidate?.view as ContainerResourceView
    : 'containers';
  return {
    version: 2,
    view,
    selectedResourceKey: compact(candidate?.selectedResourceKey),
  };
}

function availableResourceViews(runtimes: readonly ContainerRuntime[]): readonly ContainerResourceView[] {
  const ready = runtimes.filter((runtime): runtime is ReadyContainerRuntime => runtime.state === 'ready');
  if (ready.length === 0) return ['containers', 'images', 'volumes'];
  const views: ContainerResourceView[] = ['containers', 'images', 'volumes'];
  if (ready.some((runtime) => runtime.engine === 'docker')) views.push('compose-projects');
  if (ready.some((runtime) => runtime.engine === 'podman')) views.push('pods');
  return views;
}

function normalizeConsoleTarget(target: ContainerConsoleTarget): ContainerConsoleTarget {
  const views: readonly ContainerResourceView[] = ['containers', 'images', 'volumes', 'compose-projects', 'pods'];
  return {
    view: views.includes(target.view) ? target.view : 'containers',
    selectedResourceKey: compact(target.selectedResourceKey),
  };
}

function runtimeKey(target: Pick<ReadyContainerRuntime, 'engine' | 'endpoint_id'>): string {
  return `${target.engine}\u0000${target.endpoint_id}`;
}

function inventoryCacheKey(target: ReadyContainerRuntime, view: ContainerResourceView): string {
  return `${runtimeKey(target)}\u0000${view}`;
}

function resourceKey(target: ReadyContainerRuntime, view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  return `${inventoryCacheKey(target, view)}\u0000${resourceIdentity(view, item)}`;
}

function readyRuntimesForView(runtimes: readonly ContainerRuntime[], view: ContainerResourceView): ReadyContainerRuntime[] {
  return runtimes.filter((runtime): runtime is ReadyContainerRuntime => {
    if (runtime.state !== 'ready') return false;
    if (view === 'compose-projects') return runtime.engine === 'docker';
    if (view === 'pods') return runtime.engine === 'podman';
    return true;
  });
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

function identityAliases(values: readonly unknown[]): ReadonlySet<string> {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    const identity = compact(value);
    if (!identity) return;
    aliases.add(identity);
    const digestSeparator = identity.lastIndexOf('@');
    if (digestSeparator >= 0) {
      const digest = compact(identity.slice(digestSeparator + 1));
      if (digest) aliases.add(digest);
    }
  };
  values.forEach(add);
  return aliases;
}

function imageIdentityAliases(image: ImageInventoryItem): ReadonlySet<string> {
  return identityAliases([image.id, image.reference, image.digest, ...(image.tags ?? [])]);
}

function canonicalImageID(value: unknown): string {
  return compact(value).toLowerCase().replace(/^sha256:/u, '');
}

function absolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:[\\/]/iu.test(value);
}

let containerRunRowSequence = 0;

function containerRunRowID(prefix: string): string {
  containerRunRowSequence += 1;
  return `${prefix}-${containerRunRowSequence}`;
}

function emptyContainerRunPort(): ContainerRunPort {
  return {
    id: containerRunRowID('port'),
    containerPort: '',
    hostPort: '',
    hostIP: '127.0.0.1',
    protocol: 'tcp',
  };
}

function emptyContainerRunMount(type: ContainerRunMount['type'] = 'bind'): ContainerRunMount {
  return {
    id: containerRunRowID('mount'),
    type,
    source: '',
    target: '',
    readOnly: false,
    tmpfsSizeMiB: '',
    noexec: true,
    nosuid: true,
    nodev: true,
  };
}

function emptyContainerRunDraft(image = '', targetKey = ''): ContainerRunDraft {
  return {
    targetKey,
    image,
    name: '',
    entrypoint: '',
    arguments: [],
    ports: [],
    mounts: [],
    environment: [],
    cpuCount: '',
    memory: '',
    memoryUnit: 'MiB',
    networkMode: 'bridge',
    restartPolicy: 'no',
    user: '',
    readOnlyRoot: false,
    privileged: false,
    pidMode: '',
    ipcMode: '',
    pidsLimit: '',
    shmSize: '',
    shmUnit: 'MiB',
    labels: [],
    capAdd: [],
    capDrop: [],
    securityOptions: [],
    devices: [],
  };
}

function containerRunBytes(value: string, unit: 'MiB' | 'GiB'): number | undefined {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round(amount * (unit === 'GiB' ? 1024 * 1024 * 1024 : 1024 * 1024));
}

function containerRunInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function containerRunArgv(values: readonly ContainerRunArgument[]): string[] {
  return values.map((item) => item.value).filter((value) => value !== '');
}

function containerRunKeyValues(values: readonly ContainerRunKeyValue[]): string[] {
  return values
    .map((item) => `${compact(item.key)}=${item.value}`)
    .filter((value) => value !== '=');
}

function validComposeProjectName(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/u.test(compact(value).toLowerCase());
}

function parentNameFromPath(path: string): string {
  const parts = compact(path).replace(/\\/gu, '/').split('/').filter(Boolean);
  const parent = parts.at(-2) ?? '';
  return parent.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 63);
}

type ActionIconComponent = (props: { class?: string; 'aria-hidden'?: boolean | 'true' | 'false' }) => JSX.Element;

function actionPresentation(method: string): Readonly<{ icon: ActionIconComponent; destructive: boolean }> {
  if (method.endsWith('.start') || method.endsWith('.unpause')) return { icon: Play, destructive: false };
  if (method.endsWith('.stop')) return { icon: StopFilled, destructive: false };
  if (method.endsWith('.restart')) return { icon: Refresh, destructive: false };
  if (method.endsWith('.pause')) return { icon: Pause, destructive: false };
  if (method.endsWith('.kill')) return { icon: XCircle, destructive: true };
  if (method.endsWith('.remove') || method.endsWith('.down')) return { icon: Trash, destructive: true };
  return { icon: Activity, destructive: false };
}

function ActionGlyph(props: { method: string; class?: string }) {
  const Icon = actionPresentation(props.method).icon;
  return <Icon class={props.class ?? 'h-3.5 w-3.5'} aria-hidden="true" />;
}

function resourceMatchesNavigation(
  view: ContainerResourceView,
  item: ContainerResourceInventoryItem,
  requestedIdentity: string,
): boolean {
  const requested = compact(requestedIdentity);
  if (!requested) return false;
  if (view !== 'images') return resourceIdentity(view, item) === requested;
  const requestedAliases = identityAliases([requested]);
  const imageAliases = imageIdentityAliases(item as ImageInventoryItem);
  return Array.from(requestedAliases).some((alias) => imageAliases.has(alias));
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

function runtimeIssueFromError(cause: unknown): Exclude<ContainerRuntimeState, 'ready'> {
  const code = compact((cause as { code?: unknown } | null)?.code);
  if (code === 'ENGINE_PERMISSION_DENIED') return 'permission';
  if (code === 'ENGINE_UNAVAILABLE') return 'stopped';
  if (code === 'ENGINE_TIMEOUT') return 'unreachable';
  return 'error';
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

type PruneReviewResource = Readonly<{
  identity: string;
  name: string;
  references: readonly string[];
  sizeBytes?: number;
  driver: string;
}>;

type PruneReviewModel = Readonly<{
  kind: 'images' | 'volumes';
  resourceCount: number;
  reclaimableBytes?: number;
  resources: readonly PruneReviewResource[];
  complete: boolean;
}>;

function pruneReviewModel(preflight: ContainerPreflight): PruneReviewModel | null {
  if (preflight.method !== 'images.prune' && preflight.method !== 'volumes.prune') return null;
  const resourceCount = Number(preflight.plan.target.resource_count ?? 0);
  const reclaimableBytes = Number(preflight.plan.target.reclaimable_bytes);
  const reviewedIdentities = Array.isArray(preflight.plan.target.resource_identities)
    ? preflight.plan.target.resource_identities.map(compact).filter(Boolean)
    : [];
  const resources = Array.isArray(preflight.plan.target.resources)
    ? preflight.plan.target.resources.flatMap((value): PruneReviewResource[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const resource = value as Record<string, unknown>;
      const identity = compact(resource.identity);
      if (!identity) return [];
      const references = Array.isArray(resource.references)
        ? Array.from(new Set(resource.references.map(compact).filter(Boolean))).sort((left, right) => left.localeCompare(right))
        : [];
      const sizeBytes = Number(resource.size_bytes);
      return [{
        identity,
        name: compact(resource.name),
        references,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : undefined,
        driver: compact(resource.driver),
      }];
    })
    : [];
  const normalizedCount = Number.isFinite(resourceCount) ? Math.max(0, Math.floor(resourceCount)) : 0;
  const resourceIdentities = resources.map((resource) => resource.identity);
  return {
    kind: preflight.method === 'images.prune' ? 'images' : 'volumes',
    resourceCount: normalizedCount,
    reclaimableBytes: Number.isFinite(reclaimableBytes) && reclaimableBytes >= 0 ? reclaimableBytes : undefined,
    resources,
    complete: normalizedCount > 0
      && resources.length === normalizedCount
      && reviewedIdentities.length === normalizedCount
      && new Set(resourceIdentities).size === normalizedCount
      && resourceIdentities.every((identity, index) => identity === reviewedIdentities[index]),
  };
}

function shortPruneIdentity(identity: string): string {
  const value = identity.startsWith('sha256:') ? identity.slice('sha256:'.length) : identity;
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
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

function ContainerServiceBrandMark(props: { engine: ContainerEngine; remote?: boolean }) {
  const identity = () => props.engine === 'podman' ? 'podman' : 'docker';
  const defaultIcon = () => `${REDEVEN_ENV_APP_BASE_PATH}container-service-icons/${identity()}-default.svg`;
  const monoIcon = () => `url("${REDEVEN_ENV_APP_BASE_PATH}container-service-icons/${identity()}-mono.svg")`;
  return (
    <span class="container-service-brand" aria-hidden="true">
      <img class="container-service-brand__color" src={defaultIcon()} alt="" />
      <span
        class="container-service-brand__mono"
        style={{ 'mask-image': monoIcon(), '-webkit-mask-image': monoIcon() }}
      />
      <Show when={props.remote}><span class="container-service-brand__remote"><ExternalLink class="h-2.5 w-2.5" /></span></Show>
    </span>
  );
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

function DetailLinkRow(props: { label: string; value: string; onClick: () => void }) {
  return (
    <div class="container-detail-row">
      <dt>{props.label}</dt>
      <dd><button type="button" class="container-resource-link font-mono" title={props.value} onClick={props.onClick}>{props.value}<ChevronRight class="h-3.5 w-3.5" /></button></dd>
    </div>
  );
}

export function EnvContainersPage(props: { stateScope?: string; variant?: 'activity' | 'workbench' }) {
  const i18n = useI18n();
  const notify = useNotification();
  const env = useEnvContext();
  const rpc = useRedevenRpc();
  const storageKey = () => `containers:${compact(props.stateScope) || 'activity'}`;
  const restored = sanitizePersistedState(readUIStorageJSON(storageKey(), DEFAULT_STATE));
  const restoredTarget: ContainerConsoleTarget = normalizeConsoleTarget(restored);
  const [consoleState, setConsoleState] = createSignal<ContainerConsoleState>({
    phase: 'loading',
    target: restoredTarget,
    runtimes: [],
  });
  const [details, setDetails] = createSignal<unknown>(null);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [resourceFilter, setResourceFilter] = createSignal<ResourceFilter>(defaultResourceFilter(restored.view));
  const [operations, setOperations] = createSignal<ContainerOperation[]>([]);
  const [operationsOpen, setOperationsOpen] = createSignal(false);
  const [selectedOperationID, setSelectedOperationID] = createSignal('');
  const [operationEvents, setOperationEvents] = createSignal<ContainerOperationEvent[]>([]);
  const [operationEventsLoading, setOperationEventsLoading] = createSignal(false);
  const [creationMode, setCreationMode] = createSignal<CreationMode | null>(null);
  const [creationName, setCreationName] = createSignal('');
  const [creationImage, setCreationImage] = createSignal('');
  const [creationDriver, setCreationDriver] = createSignal('local');
  const [creationTargetKey, setCreationTargetKey] = createSignal('');
  const [containerRunOpen, setContainerRunOpen] = createSignal(false);
  const [containerRunDraft, setContainerRunDraft] = createSignal<ContainerRunDraft>(emptyContainerRunDraft());
  const [containerRunPortSuggestions, setContainerRunPortSuggestions] = createSignal<readonly ContainerRunPort[]>([]);
  const [containerRunAdvanced, setContainerRunAdvanced] = createSignal(false);
  const [containerPathPicker, setContainerPathPicker] = createSignal<ContainerPathPickerTarget | null>(null);
  const [containerVolumeNames, setContainerVolumeNames] = createSignal<string[]>([]);
  const [containerVolumeNamesLoading, setContainerVolumeNamesLoading] = createSignal(false);
  const [pendingContainerCreateOperationID, setPendingContainerCreateOperationID] = createSignal('');
  const [composeEditorOpen, setComposeEditorOpen] = createSignal(false);
  const [composeEditingID, setComposeEditingID] = createSignal('');
  const [composeEditorTarget, setComposeEditorTarget] = createSignal<ReadyContainerRuntime | null>(null);
  const [composeName, setComposeName] = createSignal('');
  const [composeNameTouched, setComposeNameTouched] = createSignal(false);
  const [composeConfigPaths, setComposeConfigPaths] = createSignal<string[]>([]);
  const [composeConfigPathInput, setComposeConfigPathInput] = createSignal('');
  const [composeConfigPathError, setComposeConfigPathError] = createSignal('');
  const [composeConfigPickerOpen, setComposeConfigPickerOpen] = createSignal(false);
  const [composeEnvFilePath, setComposeEnvFilePath] = createSignal('');
  const [composeEnvPickerOpen, setComposeEnvPickerOpen] = createSignal(false);
  const [composeProfiles, setComposeProfiles] = createSignal<string[]>([]);
  const [composeProfileInput, setComposeProfileInput] = createSignal('');
  const [composeProfileError, setComposeProfileError] = createSignal('');
  const [composeEditorBusy, setComposeEditorBusy] = createSignal(false);
  const [composeForget, setComposeForget] = createSignal<ContainerResourceEntry | null>(null);
  const [servicesOpen, setServicesOpen] = createSignal(false);
  const [containerServices, setContainerServices] = createSignal<ContainerService[]>([]);
  const [containerServicesLoading, setContainerServicesLoading] = createSignal(false);
  const [containerServicesError, setContainerServicesError] = createSignal('');
  const [serviceConfigurationOpen, setServiceConfigurationOpen] = createSignal(false);
  const [serviceConfigurationLoading, setServiceConfigurationLoading] = createSignal(false);
  const [serviceConfiguration, setServiceConfiguration] = createSignal<ContainerServiceConfiguration | null>(null);
  const [serviceConfigurationTarget, setServiceConfigurationTarget] = createSignal<ContainerService | null>(null);
  const [serviceConfigurationSourceID, setServiceConfigurationSourceID] = createSignal<ContainerServiceConfigurationSourceID>('engine');
  const [serviceConfigurationMode, setServiceConfigurationMode] = createSignal<ContainerServiceConfigurationSection>('proxy');
  const [serviceConfigurationSecretsVisible, setServiceConfigurationSecretsVisible] = createSignal(false);
  const [serviceConfigurationDrafts, setServiceConfigurationDrafts] = createSignal<Partial<Record<ContainerServiceConfigurationSourceID, ContainerServiceConfigurationDraft>>>({});
  const serviceConfigurationSource = createMemo<ContainerServiceConfigurationSource | null>(() => (
    serviceConfiguration()?.sources.find((source) => source.source_id === serviceConfigurationSourceID()) ?? null
  ));
  const serviceConfigurationDraft = createMemo<ContainerServiceConfigurationDraft | null>(() => (
    serviceConfigurationDrafts()[serviceConfigurationSourceID()] ?? null
  ));
  const serviceConfigurationSourceEditable = createMemo(() => {
    const source = serviceConfigurationSource();
    if (!source?.base_revision || source.status === 'permission' || source.status === 'unsupported') return false;
    return source.source_id !== 'docker_cli' || source.status !== 'invalid';
  });
  const serviceConfigurationSections = createMemo<readonly ContainerServiceConfigurationSection[]>(() => {
    return serviceConfigurationSource()?.sections ?? [];
  });
  const dockerCLIConfigurationDocument = createMemo(() => (
    serviceConfigurationSource()?.source_id === 'docker_cli'
      ? parseDockerCLIConfiguration(serviceConfigurationDraft()?.content ?? '')
      : null
  ));
  const customizedDockerCLIOutputFormatCount = createMemo(() => {
    const document = dockerCLIConfigurationDocument();
    return dockerCLIOutputFormats.filter(({ key }) => dockerCLIString(document, key).trim() !== '').length;
  });
  const containerServicesInitialLoading = createMemo(() => (
    containerServicesLoading() && containerServices().length === 0
  ));
  const [serviceConfigurationError, setServiceConfigurationError] = createSignal('');
  const [pruneOpen, setPruneOpen] = createSignal(false);
  const [pruneTargetKey, setPruneTargetKey] = createSignal('');
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
  const [execSessionID, setExecSessionID] = createSignal('');
  const [execBusy, setExecBusy] = createSignal(false);
  const [execError, setExecError] = createSignal('');
  const [execPreset, setExecPreset] = createSignal('/bin/sh');
  const [execExecutable, setExecExecutable] = createSignal('/bin/sh');
  const [execArguments, setExecArguments] = createSignal<ContainerRunArgument[]>([]);
  const reviewedPrune = createMemo(() => {
    const current = review();
    return current ? pruneReviewModel(current.preflight) : null;
  });
  let consoleLoadGeneration = 0;
  let consoleLoadAbort: AbortController | null = null;
  let waitingForEnvironment = false;
  const inventoryCache = new Map<string, readonly ContainerResourceInventoryItem[]>();
  let operationStreamAbort: AbortController | null = null;
  let operationDetailsAbort: AbortController | null = null;
  let servicesLoadAbort: AbortController | null = null;
  let logViewElement: HTMLDivElement | undefined;
  let inventoryScrollElement: HTMLDivElement | undefined;
  let storedInventoryScrollTop = 0;
  let relatedNavigationOrigin: RelatedNavigationOrigin | null = null;

  const composeFilePicker = createFilesystemPickerDataSource({
    homePath: () => '/',
    includeFiles: true,
    listDirectory: async (path) => (await rpc.fs.list({ path, showHidden: true })).entries ?? [],
  });

  const containerPathDataSource = createFilesystemPickerDataSource({
    homePath: () => '/',
    includeFiles: true,
    listDirectory: async (path) => (await rpc.fs.list({ path, showHidden: true })).entries ?? [],
  });

  const permissions = createMemo(() => env.env()?.permissions);
  const canRead = createMemo(() => Boolean(permissions()?.can_read));
  const canExecute = createMemo(() => canRead() && Boolean(permissions()?.can_execute));
  const canRWX = createMemo(() => canExecute() && Boolean(permissions()?.can_write));
  const canAdmin = createMemo(() => Boolean(permissions()?.can_admin || permissions()?.is_owner));
  const composeNameError = createMemo(() => compact(composeName()) && !validComposeProjectName(composeName())
    ? i18n.t('containers.compose.errors.name')
    : '');
  const readyConsole = createMemo(() => {
    const state = consoleState();
    return state.phase === 'ready' ? state : null;
  });
  const view = () => consoleState().target.view;
  const selectedResourceKey = () => consoleState().target.selectedResourceKey;
  const runtimes = () => consoleState().runtimes;
  const readyRuntimes = createMemo(() => runtimes().filter((runtime): runtime is ReadyContainerRuntime => runtime.state === 'ready'));
  const containerRunTargets = createMemo(() => readyRuntimes());
  const runtimeIssues = createMemo(() => runtimes().filter((runtime) => runtime.state !== 'ready'));
  const inventory = () => readyConsole()?.inventory ?? [];
  const loading = () => consoleState().phase === 'loading';
  const refreshing = () => Boolean(readyConsole()?.refreshing);
  const consoleBusy = () => loading() || refreshing();
  const availableViews = createMemo<readonly ContainerResourceView[]>(() => availableResourceViews(runtimes()));
  const selectedEntry = createMemo(() => {
    const key = selectedResourceKey();
    if (!key) return null;
    return inventory().find((entry) => entry.key === key) ?? null;
  });
  const selected = createMemo(() => selectedEntry()?.item ?? null);
  const selectedTarget = createMemo(() => selectedEntry()?.target ?? null);
  const selectedManagedOwner = createMemo(() => resourceManagement(selected())?.owner ?? null);
  const containerExecAvailable = createMemo(() => {
    const item = selected();
    return view() === 'containers'
      && Boolean(item)
      && compact((item as ContainerInventoryItem).state).toLowerCase() === 'running'
      && !selectedManagedOwner()
      && canExecute()
      && Boolean(selectedTarget()?.capabilities?.exec);
  });
  const containerRunErrors = createMemo<Record<string, string>>(() => {
    const draft = containerRunDraft();
    const errors: Record<string, string> = {};
    const invalid = (key: string, message: string) => { errors[key] = message; };
    if (!compact(draft.image)) invalid('image', i18n.t('containers.run.errors.imageRequired'));
    if (compact(draft.name) && !/^[a-z0-9][a-z0-9_.-]{0,127}$/iu.test(compact(draft.name))) invalid('name', i18n.t('containers.run.errors.name'));
    if (draft.entrypoint && (/^[\s]*-/u.test(draft.entrypoint) || hasControlCharacters(draft.entrypoint))) invalid('entrypoint', i18n.t('containers.run.errors.entrypoint'));
    draft.arguments.forEach((argument) => {
      if (hasControlCharacters(argument.value)) invalid(`argument:${argument.id}`, i18n.t('containers.run.errors.argument'));
    });
    draft.ports.forEach((port) => {
      const containerPort = Number(port.containerPort);
      const hostPort = port.hostPort === '' ? 0 : Number(port.hostPort);
      if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) invalid(`port:${port.id}`, i18n.t('containers.run.errors.port'));
      else if (!Number.isInteger(hostPort) || hostPort < 0 || hostPort > 65535) invalid(`port:${port.id}`, i18n.t('containers.run.errors.hostPort'));
      else if (!compact(port.hostIP)) invalid(`port:${port.id}`, i18n.t('containers.run.errors.listenAddress'));
    });
    draft.mounts.forEach((mount) => {
      if (!absolutePath(compact(mount.target))) invalid(`mount:${mount.id}`, i18n.t('containers.run.errors.containerPath'));
      else if (mount.type === 'bind' && !absolutePath(compact(mount.source))) invalid(`mount:${mount.id}`, i18n.t('containers.run.errors.hostPath'));
      else if (mount.type === 'volume' && !/^[a-z0-9][a-z0-9_.-]{0,127}$/iu.test(compact(mount.source))) invalid(`mount:${mount.id}`, i18n.t('containers.run.errors.volume'));
      else if (mount.type === 'tmpfs' && compact(mount.tmpfsSizeMiB) && (!Number.isFinite(Number(mount.tmpfsSizeMiB)) || Number(mount.tmpfsSizeMiB) <= 0)) invalid(`mount:${mount.id}`, i18n.t('containers.run.errors.size'));
    });
    const seenEnvironment = new Set<string>();
    draft.environment.forEach((entry) => {
      const key = compact(entry.key);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || seenEnvironment.has(key)) invalid(`environment:${entry.id}`, i18n.t('containers.run.errors.environment'));
      seenEnvironment.add(key);
    });
    const cpuCount = Number(draft.cpuCount);
    if (draft.cpuCount !== '' && (!Number.isFinite(cpuCount) || cpuCount <= 0 || cpuCount > 256)) invalid('cpuCount', i18n.t('containers.run.errors.cpu'));
    const memoryBytes = containerRunBytes(draft.memory, draft.memoryUnit);
    if (draft.memory !== '' && (!memoryBytes || memoryBytes < 4 * 1024 * 1024)) invalid('memory', i18n.t('containers.run.errors.memory'));
    const pidsLimit = containerRunInteger(draft.pidsLimit);
    if (draft.pidsLimit !== '' && (pidsLimit === undefined || pidsLimit > 1_000_000)) invalid('pidsLimit', i18n.t('containers.run.errors.pids'));
    const shmBytes = containerRunBytes(draft.shmSize, draft.shmUnit);
    if (draft.shmSize !== '' && (!shmBytes || shmBytes < 1024 * 1024)) invalid('shmSize', i18n.t('containers.run.errors.shm'));
    draft.labels.forEach((entry) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u.test(compact(entry.key))) invalid(`label:${entry.id}`, i18n.t('containers.run.errors.label'));
    });
    draft.devices.forEach((device) => {
      if (!absolutePath(compact(device.hostPath)) || (compact(device.containerPath) && !absolutePath(compact(device.containerPath)))) invalid(`device:${device.id}`, i18n.t('containers.run.errors.device'));
    });
    return errors;
  });
  const containerRunValid = createMemo(() => containerRunTargets().length > 0 && Object.keys(containerRunErrors()).length === 0);
  const activeOperationCount = createMemo(() => operations().filter(operationActive).length);
  const activeResourceCount = createMemo(() => inventory().filter((entry) => resourceActive(view(), entry.item)).length);
  const managedResourceCount = createMemo(() => inventory().filter((entry) => resourceManagement(entry.item)?.managed).length);
  const filteredInventory = createMemo(() => {
    const query = searchQuery().trim().toLocaleLowerCase();
    const filter = resourceFilter();
    const items = inventory().filter((entry) => {
      if (query && !resourceSearchText(view(), entry.item).includes(query)) return false;
      if (filter === 'active' && !resourceActive(view(), entry.item)) return false;
      if (filter === 'inactive' && resourceActive(view(), entry.item)) return false;
      if (filter === 'managed' && !resourceManagement(entry.item)?.managed) return false;
      return true;
    });
    const valueForSort = (entry: ContainerResourceEntry): string | number => {
      const item = entry.item;
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
  const runtimeBadgeVisible = (entry: ContainerResourceEntry): boolean => inventory().some((candidate) => (
    candidate.key !== entry.key
    && candidate.target.engine !== entry.target.engine
    && resourceName(view(), candidate.item) === resourceName(view(), entry.item)
  ));

  const filteredLogs = createMemo(() => {
    const query = logQuery().trim().toLocaleLowerCase();
    if (!query) return logs() ?? [];
    return (logs() ?? []).filter((line) => line.message.toLocaleLowerCase().includes(query));
  });

  createEffect(() => {
    writeUIStorageJSON(storageKey(), {
      version: 2,
      view: view(),
      selectedResourceKey: selectedResourceKey(),
    } satisfies PersistedContainersState);
  });

  const loadOperations = async () => {
    if (!canRead()) return;
    try {
      const next = await listContainerOperations();
      setOperations(next);
      const pendingID = pendingContainerCreateOperationID();
      const pendingCreate = pendingID ? next.find((operation) => operation.operation_id === pendingID) : undefined;
      if (pendingCreate && TERMINAL_OPERATION_STATES.has(pendingCreate.state)) {
        setPendingContainerCreateOperationID('');
        if (pendingCreate.state === 'succeeded') {
          setContainerRunDraft(emptyContainerRunDraft());
          setContainerRunPortSuggestions([]);
          setContainerRunAdvanced(false);
        }
      }
    } catch {
      // Inventory remains usable when operation history is temporarily unavailable.
    }
  };

  const loadContainerServices = async () => {
    if (!canRead()) return;
    servicesLoadAbort?.abort();
    const controller = new AbortController();
    servicesLoadAbort = controller;
    setContainerServicesLoading(true);
    setContainerServicesError('');
    try {
      const next = await listContainerServices(controller.signal);
      if (!controller.signal.aborted) setContainerServices(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setContainerServicesError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (!controller.signal.aborted) setContainerServicesLoading(false);
    }
  };

  const openContainerServices = () => {
    setServicesOpen(true);
    setSelectedResourceKey('');
    setDetails(null);
    void loadContainerServices();
  };

  const closeContainerServices = () => {
    setServicesOpen(false);
    setServiceConfigurationOpen(false);
    void reloadConsole(true);
  };

  const serviceOperation = (serviceID: string): ContainerOperation | undefined => operations().find((operation) => (
    operation.resource_kind === 'container_service' && operation.resource_identity === serviceID
  ));

  const openServiceOperation = (operation: ContainerOperation) => {
    setSelectedOperationID(operation.operation_id);
    setOperationsOpen(true);
  };

  const configurationDraftFromSource = (source: ContainerServiceConfigurationSource): ContainerServiceConfigurationDraft => ({
    content: source.content ?? '',
    httpProxy: source.http_proxy ?? '',
    httpsProxy: source.https_proxy ?? '',
    noProxy: source.no_proxy ?? '',
    revealHTTPProxy: false,
    revealHTTPSProxy: false,
  });

  const updateServiceConfigurationDraft = (update: Partial<ContainerServiceConfigurationDraft>) => {
    const sourceID = serviceConfigurationSourceID();
    setServiceConfigurationDrafts((current) => ({
      ...current,
      [sourceID]: { ...(current[sourceID] ?? { content: '', httpProxy: '', httpsProxy: '', noProxy: '', revealHTTPProxy: false, revealHTTPSProxy: false }), ...update },
    }));
  };

  const updateDockerCLIConfiguration = (mutate: (document: DockerCLIConfigurationDocument) => void) => {
    const current = parseDockerCLIConfiguration(serviceConfigurationDraft()?.content ?? '');
    if (!current) return;
    mutate(current);
    updateServiceConfigurationDraft({ content: `${JSON.stringify(current, null, 2)}\n` });
  };

  const setDockerCLIString = (key: string, value: string) => updateDockerCLIConfiguration((document) => {
    if (value === '') delete document[key];
    else document[key] = value;
  });

  const setDockerCLIMapEntry = (section: string, previousKey: string, key: string, value: unknown) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    if (previousKey !== key) delete entries[previousKey];
    if (key.trim() !== '') entries[key] = value;
    if (Object.keys(entries).length === 0) delete document[section];
    else document[section] = entries;
  });

  const removeDockerCLIMapEntry = (section: string, key: string) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    delete entries[key];
    if (Object.keys(entries).length === 0) delete document[section];
    else document[section] = entries;
  });

  const addDockerCLIMapEntry = (section: 'proxies' | 'credHelpers', preferredKey: string, value: unknown) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    let key = preferredKey;
    for (let suffix = 2; Object.hasOwn(entries, key); suffix += 1) key = `${preferredKey}-${suffix}`;
    entries[key] = value;
    document[section] = entries;
  });

  const selectServiceConfigurationSource = (sourceID: ContainerServiceConfigurationSourceID) => {
    const source = serviceConfiguration()?.sources.find((candidate) => candidate.source_id === sourceID);
    if (!source) return;
    setServiceConfigurationSourceID(sourceID);
    setServiceConfigurationMode(source.sections[0] ?? 'advanced');
    setServiceConfigurationError('');
  };

  const openServiceConfiguration = async (service: ContainerService) => {
    setServiceConfigurationTarget(service);
    setServiceConfiguration(null);
    setServiceConfigurationDrafts({});
    setServiceConfigurationError('');
    setServiceConfigurationSecretsVisible(false);
    setServiceConfigurationOpen(true);
    if (service.configuration.mode !== 'local') {
      setServiceConfigurationLoading(false);
      return;
    }
    setServiceConfigurationLoading(true);
    try {
      const configuration = await getContainerServiceConfiguration(service.service_id);
      if (serviceConfigurationTarget()?.service_id !== service.service_id) return;
      setServiceConfiguration(configuration);
      setServiceConfigurationDrafts(Object.fromEntries(configuration.sources.map((source) => [source.source_id, configurationDraftFromSource(source)])));
      const initialSource = configuration.sources[0];
      if (initialSource) {
        setServiceConfigurationSourceID(initialSource.source_id);
        setServiceConfigurationMode(initialSource.sections[0] ?? 'advanced');
      }
    } catch (cause) {
      if (serviceConfigurationTarget()?.service_id === service.service_id) {
        setServiceConfigurationError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (serviceConfigurationTarget()?.service_id === service.service_id) setServiceConfigurationLoading(false);
    }
  };

  const selectedOperation = createMemo(() => operations().find((operation) => operation.operation_id === selectedOperationID()) ?? null);

  const mergeOperationEvent = (event: ContainerOperationEvent) => {
    setOperationEvents((current) => {
      if (current.some((item) => item.sequence === event.sequence)) return current;
      return [...current, event].sort((left, right) => left.sequence - right.sequence).slice(-200);
    });
  };

  createEffect(() => {
    if (!operationsOpen()) {
      operationDetailsAbort?.abort();
      operationDetailsAbort = null;
      return;
    }
    const items = operations();
    if (items.length === 0) {
      setSelectedOperationID('');
      setOperationEvents([]);
      return;
    }
    if (!items.some((operation) => operation.operation_id === selectedOperationID())) {
      setSelectedOperationID((items.find(operationActive) ?? items[0]).operation_id);
    }
  });

  createEffect(() => {
    const operationID = selectedOperationID();
    if (!operationsOpen() || !operationID) return;
    operationDetailsAbort?.abort();
    const controller = new AbortController();
    operationDetailsAbort = controller;
    setOperationEvents([]);
    setOperationEventsLoading(true);
    void listContainerOperationEvents(operationID)
      .then((events) => {
        if (controller.signal.aborted) return;
        setOperationEvents(events.slice(-200));
        const after = events.at(-1)?.sequence ?? 0;
        void subscribeContainerOperationEvents(operationID, (event) => {
          if (controller.signal.aborted) return;
          mergeOperationEvent(event);
          if (TERMINAL_OPERATION_STATES.has(event.state)) controller.abort();
        }, controller.signal, after).catch(() => undefined);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOperationEvents([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOperationEventsLoading(false);
      });
    onCleanup(() => controller.abort());
  });

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
    options: Readonly<{
      rediscoverRuntimes?: boolean;
      resetListControls?: boolean;
      notifyIfSelectionMissing?: boolean;
      navigation?: Readonly<{ engine: ContainerEngine; endpointID: string; selectedIdentity: string }>;
      restoreOnSelectionMissing?: RelatedNavigationOrigin;
    }> = {},
  ) => {
    let target = normalizeConsoleTarget(requestedTarget);
    const previous = consoleState();
    let nextRuntimes = previous.runtimes;

    consoleLoadAbort?.abort();
    const controller = new AbortController();
    consoleLoadAbort = controller;
    const generation = ++consoleLoadGeneration;
    const current = () => generation === consoleLoadGeneration && !controller.signal.aborted;

    const cachedEntries = (runtimeSet: readonly ContainerRuntime[], candidate: ContainerConsoleTarget): ContainerResourceEntry[] | null => {
      const targets = readyRuntimesForView(runtimeSet, candidate.view);
      if (targets.length === 0) return null;
      const cached = targets.map((runtime) => inventoryCache.get(inventoryCacheKey(runtime, candidate.view)));
      if (cached.some((items) => items === undefined)) return null;
      return targets.flatMap((runtime, index) => (cached[index] ?? []).map((item) => ({
        key: resourceKey(runtime, candidate.view, item),
        target: runtime,
        item,
      })));
    };
    const initialCached = cachedEntries(nextRuntimes, target);
    setConsoleState(initialCached
      ? { phase: 'ready', target, runtimes: nextRuntimes, inventory: initialCached, refreshing: true }
      : { phase: 'loading', target, runtimes: nextRuntimes });
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
      if (current()) setConsoleState({ phase: 'permission', target, runtimes: [] });
      return;
    }

    try {
      if (nextRuntimes.length === 0 || options.rediscoverRuntimes) {
        nextRuntimes = await listContainerRuntimes(controller.signal);
        if (!current()) return;
      }
      const allowedViews = availableResourceViews(nextRuntimes);
      if (!allowedViews.includes(target.view)) {
        target = { view: 'containers', selectedResourceKey: '' };
      }
      const runtimeTargets = readyRuntimesForView(nextRuntimes, target.view);
      if (runtimeTargets.length === 0) {
        setConsoleState({ phase: 'unavailable', target, runtimes: nextRuntimes });
        return;
      }

      const cached = cachedEntries(nextRuntimes, target);
      setConsoleState(cached
        ? { phase: 'ready', target, runtimes: nextRuntimes, inventory: cached, refreshing: true }
        : { phase: 'loading', target, runtimes: nextRuntimes });

      const results = await Promise.all(runtimeTargets.map(async (runtime) => {
        try {
          const items = await listContainerResources(target.view, runtime.engine, runtime.endpoint_id, controller.signal);
          return { runtime, items } as const;
        } catch (cause) {
          return { runtime, cause } as const;
        }
      }));
      if (!current()) return;
      const failedRuntimeStates = new Map<string, Exclude<ContainerRuntimeState, 'ready'>>();
      const entries: ContainerResourceEntry[] = [];
      for (const result of results) {
        if ('cause' in result) {
          failedRuntimeStates.set(runtimeKey(result.runtime), runtimeIssueFromError(result.cause));
          continue;
        }
        inventoryCache.set(inventoryCacheKey(result.runtime, target.view), result.items);
        entries.push(...result.items.map((item) => ({
          key: resourceKey(result.runtime, target.view, item),
          target: result.runtime,
          item,
        })));
      }
      if (failedRuntimeStates.size > 0) {
        nextRuntimes = nextRuntimes.map((runtime) => {
          if (runtime.state !== 'ready') return runtime;
          const failedState = failedRuntimeStates.get(runtimeKey(runtime));
          return failedState ? { engine: runtime.engine, state: failedState } : runtime;
        });
      }
      if (results.every((result) => 'cause' in result)) {
        setConsoleState({ phase: 'unavailable', target, runtimes: nextRuntimes });
        return;
      }
      let nextSelectedResourceKey = target.selectedResourceKey;
      let navigationSelectionMissing = false;
      if (options.navigation) {
        const navigation = options.navigation;
        const selectedEntry = entries.find((entry) => (
          entry.target.engine === navigation.engine
          && (!navigation.endpointID || entry.target.endpoint_id === navigation.endpointID)
          && resourceMatchesNavigation(target.view, entry.item, navigation.selectedIdentity)
        ));
        nextSelectedResourceKey = selectedEntry?.key ?? '';
        navigationSelectionMissing = !selectedEntry;
      }
      const selectedStillExists = !nextSelectedResourceKey || entries.some((entry) => entry.key === nextSelectedResourceKey);
      if (!selectedStillExists && options.restoreOnSelectionMissing) {
        const origin = options.restoreOnSelectionMissing;
        relatedNavigationOrigin = null;
        setConsoleState(origin.state);
        setDetailTab(origin.detailTab);
        queueMicrotask(() => {
          if (inventoryScrollElement) inventoryScrollElement.scrollTop = origin.scrollTop;
        });
        notify.info(i18n.t('containers.notifications.relatedMissingTitle'), i18n.t('containers.notifications.relatedMissingMessage'));
        return;
      }
      const readyTarget = { ...target, selectedResourceKey: selectedStillExists ? nextSelectedResourceKey : '' };
      setConsoleState({ phase: 'ready', target: readyTarget, runtimes: nextRuntimes, inventory: entries, refreshing: false });
      if ((navigationSelectionMissing || !selectedStillExists) && options.notifyIfSelectionMissing) {
        notify.info(i18n.t('containers.notifications.inventoryChangedTitle'), i18n.t('containers.notifications.inventoryChangedMessage'));
      }
    } catch (cause) {
      if (!current()) return;
      if (runtimeIssueFromError(cause) === 'permission') {
        setConsoleState({ phase: 'permission', target, runtimes: nextRuntimes });
      } else {
        setConsoleState({
          phase: 'error',
          target,
          runtimes: nextRuntimes,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  };

  const reloadConsole = (rediscoverRuntimes = false) => loadConsole(
    consoleState().target,
    { rediscoverRuntimes, notifyIfSelectionMissing: true },
  );

  const setSelectedResourceKey = (key: string) => {
    setConsoleState((state) => ({ ...state, target: { ...state.target, selectedResourceKey: compact(key) } }));
  };

  createEffect(() => {
    const environment = env.env();
    if (environment === undefined || !waitingForEnvironment) return;
    waitingForEnvironment = false;
    void loadConsole(consoleState().target, { rediscoverRuntimes: true });
  });

  const loadNavigation = (request: ContainerResourceNavigation) => loadConsole(
    normalizeConsoleTarget({ view: request.view, selectedResourceKey: '' }),
    {
      rediscoverRuntimes: true,
      resetListControls: true,
      notifyIfSelectionMissing: true,
      navigation: {
        engine: request.engine,
        endpointID: request.endpointID,
        selectedIdentity: request.selectedIdentity,
      },
    },
  );

  onMount(() => {
    const handlesNavigation = !compact(props.stateScope) || props.stateScope === 'activity';
    const pendingNavigation = handlesNavigation ? consumeContainerResourceNavigation() : null;
    void (pendingNavigation
      ? loadNavigation(pendingNavigation)
      : loadConsole(restoredTarget, { rediscoverRuntimes: true }));
    if (!handlesNavigation) return;
    const unsubscribe = subscribeContainerResourceNavigation((request) => void loadNavigation(request));
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const ready = readyConsole();
    const entry = selectedEntry();
    if (!ready || !entry) {
      setDetails(null);
      return;
    }
    const identity = resourceIdentity(ready.target.view, entry.item);
    let active = true;
    getContainerResourceDetails(ready.target.view, identity, entry.target.engine, entry.target.endpoint_id)
      .then((value) => active && setDetails(value))
      .catch(() => active && setDetails(null));
    onCleanup(() => { active = false; });
  });

  createEffect(() => {
    if (!containerRunOpen()) return;
    const target = selectedContainerRunTarget();
    if (!target) {
      setContainerVolumeNames([]);
      return;
    }
    const cached = inventoryCache.get(inventoryCacheKey(target, 'volumes'));
    if (cached) {
      setContainerVolumeNames(cached.map((item) => (item as VolumeInventoryItem).name).filter(Boolean));
      return;
    }
    const controller = new AbortController();
    setContainerVolumeNamesLoading(true);
    void listContainerResources('volumes', target.engine, target.endpoint_id, controller.signal)
      .then((items) => {
        inventoryCache.set(inventoryCacheKey(target, 'volumes'), items);
        setContainerVolumeNames(items.map((item) => (item as VolumeInventoryItem).name).filter(Boolean));
      })
      .catch(() => setContainerVolumeNames([]))
      .finally(() => setContainerVolumeNamesLoading(false));
    onCleanup(() => controller.abort());
  });

  createEffect(() => {
    selectedResourceKey();
    const available = containerExecAvailable();
    if (!available && execSessionID()) void closeExecSession();
  });

  createEffect(() => {
    if (!operations().some(operationActive)) return;
    const timer = window.setInterval(() => void loadOperations(), 1200);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const ready = readyConsole();
    const targets = readyRuntimesForView(ready?.runtimes ?? [], 'containers')
      .filter((runtime) => runtime.capabilities?.collection_stats);
    if (!ready || !chartsOpen() || ready.target.view !== 'containers' || targets.length === 0) {
      setCollectionStats(new Map());
      return;
    }
    const controllers = targets.map((target) => {
      const controller = new AbortController();
      void subscribeContainerStatsCollection(target.engine, target.endpoint_id, (sample) => {
        if (controller.signal.aborted) return;
        const prefix = `${runtimeKey(target)}\u0000`;
        setCollectionStats((current) => {
          const next = new Map([...current].filter(([key]) => !key.startsWith(prefix)));
          sample.samples.forEach((item) => next.set(`${prefix}${item.container_id}`, item));
          return next;
        });
      }, controller.signal).catch(() => undefined);
      return controller;
    });
    onCleanup(() => controllers.forEach((controller) => controller.abort()));
  });

  createEffect(() => {
    const ready = readyConsole();
    const entry = selectedEntry();
    if (!ready || !entry || detailTab() !== 'stats' || ready.target.view !== 'containers') return;
    const identity = resourceIdentity('containers', entry.item);
    const controller = new AbortController();
    let active = true;
    setStats(null);
    setStatsHistory([]);
    setStatsLoading(true);
    setStatsError('');
    void subscribeContainerStats(identity, entry.target.engine, entry.target.endpoint_id, (sample) => {
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
    const entry = selectedEntry();
    if (!ready || !entry || detailTab() !== 'logs' || ready.target.view !== 'containers') return;
    const identity = resourceIdentity('containers', entry.item);
    const controller = new AbortController();
    let active = true;
    void tailContainerLogs(identity, entry.target.engine, entry.target.endpoint_id)
      .then((lines) => active && setLogs(lines))
      .catch(() => active && setLogs([]));
    void subscribeContainerLogs(identity, entry.target.engine, entry.target.endpoint_id, (line) => {
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
    const entry = selectedEntry();
    if (!ready || !entry || detailTab() !== 'layers' || ready.target.view !== 'images') return;
    const identity = resourceIdentity('images', entry.item);
    let active = true;
    setImageHistory([]);
    setImageHistoryLoading(true);
    setImageHistoryError('');
    void getContainerImageHistory(identity, entry.target.engine, entry.target.endpoint_id)
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
    const entry = selectedEntry();
    if (!ready || !entry || detailTab() !== 'files' || ready.target.view !== 'volumes') return;
    if (!canAdmin()) return;
    if (!entry.target.capabilities?.volume_files) return;
    const identity = resourceIdentity('volumes', entry.item);
    let active = true;
    setFilesLoading(true);
    void listContainerResourceFiles('volumes', identity, filePath(), entry.target.engine, entry.target.endpoint_id)
      .then((listing) => active && setFileEntries([...listing.entries]))
      .catch(() => active && setFileEntries([]))
      .finally(() => active && setFilesLoading(false));
    onCleanup(() => { active = false; });
  });

  onMount(() => void loadOperations());
  onCleanup(() => {
    consoleLoadAbort?.abort();
    servicesLoadAbort?.abort();
    operationStreamAbort?.abort();
    operationDetailsAbort?.abort();
    void closeExecSession();
  });

  const openRelatedResource = async (
    source: ContainerResourceEntry,
    targetView: ContainerResourceView,
    match: (item: ContainerResourceInventoryItem) => boolean,
  ) => {
    const originState = readyConsole();
    if (!originState) return;
    const origin: RelatedNavigationOrigin = {
      state: originState,
      detailTab: detailTab(),
      scrollTop: originState.target.selectedResourceKey
        ? storedInventoryScrollTop
        : inventoryScrollElement?.scrollTop ?? storedInventoryScrollTop,
    };
    try {
      const items = await listContainerResources(targetView, source.target.engine, source.target.endpoint_id);
      if (readyConsole() !== originState) return;
      const matches = items.filter(match);
      if (matches.length !== 1) {
        notify.info(
          i18n.t(matches.length > 1 ? 'containers.notifications.relatedAmbiguousTitle' : 'containers.notifications.relatedMissingTitle'),
          i18n.t(matches.length > 1 ? 'containers.notifications.relatedAmbiguousMessage' : 'containers.notifications.relatedMissingMessage'),
        );
        return;
      }
      inventoryCache.set(inventoryCacheKey(source.target, targetView), items);
      relatedNavigationOrigin = origin;
      await loadConsole(
        { view: targetView, selectedResourceKey: resourceKey(source.target, targetView, matches[0]) },
        { restoreOnSelectionMissing: origin },
      );
    } catch (cause) {
      if (readyConsole() !== originState) return;
      notify.error(
        i18n.t('containers.notifications.relatedMissingTitle'),
        cause instanceof Error ? cause.message : i18n.t('containers.notifications.relatedMissingMessage'),
      );
    }
  };

  const openContainerImage = (entry: ContainerResourceEntry) => {
    const container = entry.item as ContainerInventoryItem;
    const imageID = canonicalImageID(container.image_id);
    const referenceAliases = identityAliases([container.image?.reference, container.image?.digest]);
    void openRelatedResource(entry, 'images', (item) => {
      const image = item as ImageInventoryItem;
      if (imageID) return canonicalImageID(image.id) === imageID;
      const aliases = imageIdentityAliases(image);
      return Array.from(referenceAliases).some((alias) => aliases.has(alias));
    });
  };

  const openNamedVolume = (name: string) => {
    const source = selectedEntry();
    if (!source || !compact(name)) return;
    void openRelatedResource(source, 'volumes', (item) => resourceIdentity('volumes', item) === compact(name));
  };

  const selectResource = (entry: ContainerResourceEntry) => {
    relatedNavigationOrigin = null;
    storedInventoryScrollTop = inventoryScrollElement?.scrollTop ?? 0;
    setSelectedResourceKey(entry.key);
    setDetailTab('overview');
    setLogs(null);
    setStats(null);
    setRawInspect(null);
    setImageHistory([]);
    setImageHistoryError('');
    setFilePath('/');
    setFileEntries([]);
  };

  const closeExecSession = async () => {
    const sessionID = execSessionID();
    setExecSessionID('');
    if (!sessionID) return;
    await deleteContainerExecSession(sessionID).catch(() => undefined);
  };

  const startExecSession = async (argv: readonly string[]) => {
    const entry = selectedEntry();
    if (!entry || !containerExecAvailable() || execBusy()) return;
    const container = entry.item as ContainerInventoryItem;
    const selectedKey = entry.key;
    setExecBusy(true);
    setExecError('');
    await closeExecSession();
    try {
      const result = await createContainerExecSession(
        container.container_id,
        entry.target.engine,
        entry.target.endpoint_id,
        argv,
      );
      if (selectedEntry()?.key !== selectedKey || !containerExecAvailable()) {
        await deleteContainerExecSession(result.session_id).catch(() => undefined);
        return;
      }
      setExecSessionID(result.session_id);
    } catch (cause) {
      setExecError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExecBusy(false);
    }
  };

  const openExecTab = (entry?: ContainerResourceEntry) => {
    if (entry) selectResource(entry);
    setDetailTab('exec');
    setExecPreset('/bin/sh');
    setExecExecutable('/bin/sh');
    setExecArguments([]);
    queueMicrotask(() => void startExecSession(['/bin/sh']));
  };

  const selectDetailTab = (tab: DetailTab) => {
    setDetailTab(tab);
    if (tab === 'exec' && !execSessionID() && !execBusy()) {
      const argv = [compact(execExecutable()) || '/bin/sh', ...containerRunArgv(execArguments())];
      void startExecSession(argv);
    }
  };

  const chooseExecProgram = (program: string) => {
    setExecPreset(program);
    setExecExecutable(program);
    setExecArguments([]);
    void startExecSession([program]);
  };

  const runCustomExecProgram = () => {
    const executable = compact(execExecutable());
    if (!executable) return;
    setExecPreset('custom');
    void startExecSession([executable, ...containerRunArgv(execArguments())]);
  };

  const closeDetails = () => {
    void closeExecSession();
    const origin = relatedNavigationOrigin;
    if (origin) {
      relatedNavigationOrigin = null;
      void loadConsole(origin.state.target).then(() => {
        setDetailTab(origin.detailTab);
        queueMicrotask(() => {
          if (inventoryScrollElement) inventoryScrollElement.scrollTop = origin.scrollTop;
        });
      });
      return;
    }
    setSelectedResourceKey('');
    queueMicrotask(() => {
      if (inventoryScrollElement) inventoryScrollElement.scrollTop = storedInventoryScrollTop;
    });
  };

  const viewLabel = (value: ContainerResourceView): string => i18n.t(`containers.views.${value}` as Parameters<typeof i18n.t>[0]);
  const runtimeName = (value: ContainerEngine): string => i18n.t(`containers.runtimeNames.${value}` as Parameters<typeof i18n.t>[0]);
  const runtimeSummary = () => `${runtimeName('docker')} / ${runtimeName('podman')}`;

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
      'container.services.start': 'containers.actions.start',
      'container.services.stop': 'containers.actions.stop',
      'container.services.restart': 'containers.actions.restart',
      'container.services.configuration.update': 'containers.services.updateConfiguration',
    };
    const key = labels[method];
    return key ? i18n.t(key) : method;
  };

  const operationStateLabel = (state: ContainerOperation['state']): string => (
    i18n.t(`containers.operationStates.${state}` as Parameters<typeof i18n.t>[0])
  );

  const operationPhaseLabel = (phase: string): string => {
    const normalized = compact(phase) || 'queued';
    const known = new Set(['queued', 'running', 'executing', 'resolving', 'pulling', 'extracting', 'verifying', 'reconciling', 'succeeded', 'failed', 'cancel_requested', 'canceling', 'canceled', 'interrupted']);
    return known.has(normalized)
      ? i18n.t(`containers.operations.phases.${normalized}` as Parameters<typeof i18n.t>[0])
      : normalized;
  };

  const progressFromEvent = (event: ContainerOperationEvent | undefined) => {
    const payload = event?.payload;
    const phase = typeof payload?.phase === 'string' ? payload.phase : event?.type ?? '';
    const downloadedBytes = typeof payload?.downloaded_bytes === 'number' ? payload.downloaded_bytes : 0;
    const totalBytes = typeof payload?.total_bytes === 'number' ? payload.total_bytes : 0;
    const completedLayers = typeof payload?.completed_layers === 'number' ? payload.completed_layers : 0;
    const totalLayers = typeof payload?.total_layers === 'number' ? payload.total_layers : 0;
    if (totalBytes > 0) {
      return {
        phase,
        current: downloadedBytes,
        total: totalBytes,
        summary: `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`,
      };
    }
    return {
      phase,
      current: completedLayers,
      total: totalLayers,
      summary: totalLayers > 0 ? `${completedLayers} / ${totalLayers} ${i18n.t('containers.operations.layers')}` : '',
    };
  };

  const latestOperationProgress = createMemo(() => progressFromEvent([...operationEvents()].reverse().find((event) => event.type === 'progress')));

  const operationDuration = (operation: ContainerOperation): string => {
    const start = operation.started_at_unix_ms || operation.created_at_unix_ms;
    const end = operation.finished_at_unix_ms || Date.now();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 60) return i18n.t('containers.operations.seconds', { count: seconds });
    return i18n.t('containers.operations.minutes', { count: Math.max(1, Math.round(seconds / 60)) });
  };

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
      if (generation === consoleLoadGeneration) {
        if (draft.method === 'containers.create') setContainerRunOpen(true);
        if (draft.method === 'container.services.configuration.update') setServiceConfigurationOpen(true);
        if (cause instanceof LocalApiError && cause.code === 'NOTHING_TO_PRUNE') {
          notify.info(i18n.t('containers.prune.nothingTitle'), i18n.t('containers.prune.nothingMessage'));
          void reloadConsole();
        } else if (cause instanceof LocalApiError && cause.code === 'REFERENCE_STATE_INCOMPLETE') {
          notify.error(i18n.t('containers.prune.referenceIncompleteTitle'), i18n.t('containers.prune.referenceIncompleteMessage'));
          void reloadConsole();
        } else {
          notify.error(i18n.t('containers.notifications.preflightFailedTitle'), cause instanceof Error ? cause.message : String(cause));
        }
      }
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
      if (current.preflight.method === 'containers.create') {
        setPendingContainerCreateOperationID(operation.operation_id);
      }
      setReview(null);
      setSelectedOperationID(operation.operation_id);
      if (current.preflight.resource_kind !== 'container_service') setOperationsOpen(true);
      setOperations((previous) => [operation, ...previous.filter((item) => item.operation_id !== operation.operation_id)]);
      operationStreamAbort?.abort();
      const controller = new AbortController();
      operationStreamAbort = controller;
      void subscribeContainerOperation(operation.operation_id, (next) => {
        setOperations((previous) => [next, ...previous.filter((item) => item.operation_id !== next.operation_id)]);
        if (TERMINAL_OPERATION_STATES.has(next.state)) {
          void reloadConsole();
          if (next.resource_kind === 'container_service') void loadContainerServices();
          const ownsContainerDraft = pendingContainerCreateOperationID() === next.operation_id;
          if (ownsContainerDraft) setPendingContainerCreateOperationID('');
          if (next.state === 'succeeded') {
            if (ownsContainerDraft) {
              setContainerRunDraft(emptyContainerRunDraft());
              setContainerRunPortSuggestions([]);
              setContainerRunAdvanced(false);
            }
            notify.success(i18n.t('containers.notifications.operationCompleteTitle'), i18n.t('containers.notifications.operationCompleteMessage'));
          }
        }
      }, controller.signal).catch(() => loadOperations());
    } catch (cause) {
      if (current.preflight.method === 'containers.create') setContainerRunOpen(true);
      notify.error(i18n.t('containers.notifications.operationFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const cancelReview = () => {
    if (review()?.preflight.method === 'containers.create') setContainerRunOpen(true);
    if (review()?.preflight.method === 'container.services.configuration.update') setServiceConfigurationOpen(true);
    setReview(null);
  };

  const actionRequest = (method: string, targetEntry?: ContainerResourceEntry | null): MutationDraft | null => {
    const entry = targetEntry ?? selectedEntry();
    if (!entry) return null;
    const item = entry.item;
    const base = { engine: entry.target.engine, endpoint_id: entry.target.endpoint_id };
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

  const runContainerServiceAction = (service: ContainerService, action: 'start' | 'stop' | 'restart') => {
    const method = `container.services.${action}`;
    beginMutation({
      method,
      request: { engine: service.engine, service_id: service.service_id },
      ...(action === 'stop' || action === 'restart'
        ? { confirmationLabel: service.name, confirmationValue: service.name }
        : {}),
    });
  };

  const submitServiceConfiguration = (applyMode: 'save' | 'save_and_restart') => {
    const service = serviceConfigurationTarget();
    const source = serviceConfigurationSource();
    const draft = serviceConfigurationDraft();
    if (!service || !source || !draft || !source.base_revision) return;
    const mode = serviceConfigurationMode();
    const request = {
      engine: service.engine,
      service_id: service.service_id,
      source_id: source.source_id,
      base_revision: source.base_revision,
      mode: source.source_id === 'docker_cli' || mode === 'advanced' ? 'document' : 'proxy',
      apply_mode: applyMode,
      ...(source.source_id !== 'docker_cli' && mode === 'proxy'
        ? { http_proxy: draft.httpProxy, https_proxy: draft.httpsProxy, no_proxy: draft.noProxy }
        : { content: draft.content }),
    };
    setServiceConfigurationOpen(false);
    beginMutation({
      method: 'container.services.configuration.update',
      request,
      confirmationLabel: service.name,
      confirmationValue: service.name,
    });
  };

  const runRowAction = (event: MouseEvent, entry: ContainerResourceEntry, method: string) => {
    event.stopPropagation();
    const request = actionRequest(method, entry);
    if (request) beginMutation(request);
  };

  const runRowMenuAction = (entry: ContainerResourceEntry, method: string) => {
    if (method === 'compose.definition.edit') {
      void openComposeEditor(entry);
      return;
    }
    if (method === 'compose.definition.forget') {
      setComposeForget(entry);
      return;
    }
    const request = actionRequest(method, entry);
    if (request) beginMutation(request);
  };

  const openImageRun = (event: MouseEvent, entry: ContainerResourceEntry) => {
    event.stopPropagation();
    const image = resourceIdentity('images', entry.item);
    openContainerRun(image, entry.target);
    void getContainerResourceDetails('images', image, entry.target.engine, entry.target.endpoint_id)
      .then((value) => {
        if (!containerRunOpen() || containerRunDraft().image !== image || containerRunDraft().targetKey !== runtimeKey(entry.target)) return;
        setContainerRunPortSuggestions(containerRunSuggestedPorts(value));
      })
      .catch(() => undefined);
  };

  const runSelectedImage = () => {
    const entry = selectedEntry();
    if (!entry) return;
    openContainerRun(resourceIdentity('images', entry.item), entry.target, containerRunSuggestedPorts(selectedDetailRecord()));
  };

  const pruneCandidates = createMemo(() => readyRuntimesForView(runtimes(), view()));

  const runPrune = (targetKey: string) => {
    const target = pruneCandidates().find((item) => runtimeKey(item) === targetKey);
    if (!target) return;
    setPruneOpen(false);
    beginMutation({
      method: view() === 'images' ? 'images.prune' : 'volumes.prune',
      request: {
        engine: target.engine,
        endpoint_id: target.endpoint_id,
      },
    });
  };

  const prune = () => {
    const candidates = pruneCandidates();
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      runPrune(runtimeKey(candidates[0]));
      return;
    }
    const preferred = candidates.find((candidate) => candidate.engine === 'docker') ?? candidates[0];
    setPruneTargetKey(runtimeKey(preferred));
    setPruneOpen(true);
  };

  const creationTargets = createMemo(() => {
    const mode = creationMode();
    if (!mode) return [];
    if (mode === 'image-tag') return selectedTarget() ? [selectedTarget()!] : [];
    if (mode === 'pod') return readyRuntimes().filter((runtime) => runtime.engine === 'podman');
    return readyRuntimes();
  });

  const updateContainerRunDraft = (patch: Partial<ContainerRunDraft>) => {
    setContainerRunDraft((current) => ({ ...current, ...patch }));
  };

  const updateContainerRunArgument = (id: string, value: string) => {
    updateContainerRunDraft({ arguments: containerRunDraft().arguments.map((item) => item.id === id ? { ...item, value } : item) });
  };

  const updateContainerRunPort = (id: string, patch: Partial<ContainerRunPort>) => {
    updateContainerRunDraft({ ports: containerRunDraft().ports.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };

  const updateContainerRunMount = (id: string, patch: Partial<ContainerRunMount>) => {
    updateContainerRunDraft({ mounts: containerRunDraft().mounts.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };

  const updateContainerRunEnvironment = (id: string, patch: Partial<ContainerRunKeyValue>) => {
    updateContainerRunDraft({ environment: containerRunDraft().environment.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };

  const updateContainerRunLabel = (id: string, patch: Partial<ContainerRunKeyValue>) => {
    updateContainerRunDraft({ labels: containerRunDraft().labels.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };

  const updateContainerRunDevice = (id: string, patch: Partial<ContainerRunDevice>) => {
    updateContainerRunDraft({ devices: containerRunDraft().devices.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };

  const selectedContainerRunTarget = () => {
    const draft = containerRunDraft();
    return containerRunTargets().find((runtime) => runtimeKey(runtime) === draft.targetKey) ?? containerRunTargets()[0] ?? null;
  };

  const openContainerRun = (image = '', forcedTarget?: ReadyContainerRuntime, suggestedPorts: readonly ContainerRunPort[] = []) => {
    if (!image && containerRunDraft().image && !pendingContainerCreateOperationID()) {
      setContainerRunOpen(true);
      return;
    }
    const candidates = forcedTarget ? [forcedTarget] : containerRunTargets();
    const preferred = candidates.find((runtime) => runtime.engine === 'docker') ?? candidates[0];
    setContainerRunDraft(emptyContainerRunDraft(image, preferred ? runtimeKey(preferred) : ''));
    setContainerRunPortSuggestions(suggestedPorts);
    setContainerRunAdvanced(false);
    setContainerRunOpen(true);
    setContainerPathPicker(null);
  };

  const closeContainerRun = () => {
    setContainerRunOpen(false);
    setContainerPathPicker(null);
    setContainerRunDraft(emptyContainerRunDraft());
    setContainerRunPortSuggestions([]);
    setContainerRunAdvanced(false);
  };

  const openContainerPathPicker = (target: ContainerPathPickerTarget) => {
    containerPathDataSource.reset();
    setContainerPathPicker(target);
  };

  const acceptContainerPath = (path: string) => {
    const target = containerPathPicker();
    if (!target || !compact(path)) return;
    if (target.owner === 'mount') updateContainerRunMount(target.id, { source: path });
    else updateContainerRunDevice(target.id, { hostPath: path });
    setContainerPathPicker(null);
  };

  const submitContainerRun = () => {
    const draft = containerRunDraft();
    const target = selectedContainerRunTarget();
    if (!target || !containerRunValid()) return;
    const request: Record<string, unknown> = {
      engine: target.engine,
      endpoint_id: target.endpoint_id,
      image: compact(draft.image),
      name: compact(draft.name),
      entrypoint: compact(draft.entrypoint),
      command: containerRunArgv(draft.arguments),
      env: containerRunKeyValues(draft.environment),
      labels: Object.fromEntries(draft.labels.map((entry) => [compact(entry.key), entry.value]).filter(([key]) => Boolean(key))),
      restart_policy: draft.restartPolicy,
      network_mode: compact(draft.networkMode) || 'bridge',
      ports: draft.ports.map((port) => ({
        container_port: Number(port.containerPort),
        ...(port.hostPort !== '' ? { host_port: Number(port.hostPort) } : {}),
        host_ip: compact(port.hostIP) || '127.0.0.1',
        protocol: port.protocol,
      })),
      mounts: draft.mounts.map((mount) => ({
        type: mount.type,
        ...(mount.type !== 'tmpfs' ? { source: compact(mount.source) } : {}),
        target: compact(mount.target),
        ...(mount.readOnly ? { read_only: true } : {}),
        ...(mount.type === 'tmpfs' ? {
          tmpfs_options: [
            ...(compact(mount.tmpfsSizeMiB) ? [`size=${Math.round(Number(mount.tmpfsSizeMiB) * 1024 * 1024)}`] : []),
            ...(mount.noexec ? ['noexec'] : []),
            ...(mount.nosuid ? ['nosuid'] : []),
            ...(mount.nodev ? ['nodev'] : []),
          ],
        } : {}),
      })),
      ...(draft.cpuCount !== '' ? { cpu_count: Number(draft.cpuCount) } : {}),
      ...(draft.memory !== '' ? { memory_bytes: containerRunBytes(draft.memory, draft.memoryUnit) } : {}),
      pid_mode: compact(draft.pidMode),
      ipc_mode: compact(draft.ipcMode),
      cap_add: containerRunArgv(draft.capAdd),
      cap_drop: containerRunArgv(draft.capDrop),
      devices: draft.devices.map((device) => ({
        host_path: compact(device.hostPath),
        ...(compact(device.containerPath) ? { container_path: compact(device.containerPath) } : {}),
        ...(compact(device.permissions) ? { permissions: compact(device.permissions) } : {}),
      })),
      privileged: draft.privileged,
      read_only_root: draft.readOnlyRoot,
      security_opts: containerRunArgv(draft.securityOptions),
      ...(draft.pidsLimit !== '' ? { pids_limit: Number(draft.pidsLimit) } : {}),
      ...(draft.shmSize !== '' ? { shm_size_bytes: containerRunBytes(draft.shmSize, draft.shmUnit) } : {}),
      user: compact(draft.user),
    };
    setContainerRunOpen(false);
    beginMutation({ method: 'containers.create', request });
  };

  const submitCreation = () => {
    const mode = creationMode();
    const target = creationTargets().find((runtime) => runtimeKey(runtime) === creationTargetKey()) ?? creationTargets()[0];
    if (!target) return;
    const base = { engine: target.engine, endpoint_id: target.endpoint_id };
    let draft: MutationDraft | null = null;
    if (mode === 'image') {
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

  const openCreation = (mode: CreationMode, forcedTarget?: ReadyContainerRuntime) => {
    setCreationName('');
    setCreationImage('');
    setCreationDriver('local');
    setCreationMode(mode);
    const compatibleTargets = forcedTarget
      ? [forcedTarget]
      : mode === 'pod'
        ? readyRuntimes().filter((runtime) => runtime.engine === 'podman')
        : mode === 'image-tag' && selectedTarget()
          ? [selectedTarget()!]
          : readyRuntimes();
    const preferred = compatibleTargets.find((runtime) => runtime.engine === 'docker') ?? compatibleTargets[0];
    setCreationTargetKey(preferred ? runtimeKey(preferred) : '');
  };

  const resetComposeEditor = () => {
    setComposeEditingID('');
    setComposeName('');
    setComposeNameTouched(false);
    setComposeConfigPaths([]);
    setComposeConfigPathInput('');
    setComposeConfigPathError('');
    setComposeConfigPickerOpen(false);
    setComposeEnvFilePath('');
    setComposeEnvPickerOpen(false);
    setComposeProfiles([]);
    setComposeProfileInput('');
    setComposeProfileError('');
    composeFilePicker.reset();
  };

  const addComposeConfigPaths = (paths: readonly string[]) => {
    const additions = paths.map(compact).filter(Boolean);
    const invalid = additions.find((path) => !absolutePath(path));
    if (invalid) {
      setComposeConfigPathError(i18n.t('containers.compose.errors.absolutePath'));
      return;
    }
    const next = [...composeConfigPaths()];
    for (const path of additions) {
      if (!next.includes(path)) next.push(path);
    }
    if (next.length > 8) {
      setComposeConfigPathError(i18n.t('containers.compose.errors.fileLimit'));
      return;
    }
    setComposeConfigPaths(next);
    setComposeConfigPathInput('');
    setComposeConfigPathError('');
    if (!composeNameTouched() && !compact(composeName())) {
      const suggestion = parentNameFromPath(additions[0] ?? '');
      if (suggestion) setComposeName(suggestion);
    }
  };

  const addComposeConfigPathInput = () => {
    const path = compact(composeConfigPathInput());
    if (path) addComposeConfigPaths([path]);
  };

  const acceptComposeConfigSelection = (paths: readonly string[]) => {
    setComposeConfigPaths([...paths]);
    setComposeConfigPathError('');
    if (!composeNameTouched() && !compact(composeName())) {
      const suggestion = parentNameFromPath(paths[0] ?? '');
      if (suggestion) setComposeName(suggestion);
    }
  };

  const moveComposeConfigPath = (index: number, offset: -1 | 1) => {
    const next = [...composeConfigPaths()];
    const destination = index + offset;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    setComposeConfigPaths(next);
  };

  const openComposeFilePicker = (kind: 'config' | 'env') => {
    composeFilePicker.reset();
    if (kind === 'config') setComposeConfigPickerOpen(true);
    else setComposeEnvPickerOpen(true);
    void composeFilePicker.ensureRootLoaded().catch((cause) => {
      if (kind === 'config') setComposeConfigPickerOpen(false);
      else setComposeEnvPickerOpen(false);
      notify.error(
        i18n.t('containers.notifications.filePickerFailedTitle'),
        cause instanceof Error ? cause.message : i18n.t('containers.notifications.filePickerFailedMessage'),
      );
    });
  };

  const addComposeProfile = (raw: string) => {
    const profile = compact(raw);
    if (!profile) return;
    if (profile.length > 64 || /[\s/\\]/u.test(profile) || profile.startsWith('-')) {
      setComposeProfileError(i18n.t('containers.compose.errors.profile'));
      return;
    }
    if (!composeProfiles().includes(profile)) setComposeProfiles((current) => [...current, profile]);
    setComposeProfileInput('');
    setComposeProfileError('');
  };

  const updateComposeProfileInput = (value: string) => {
    const parts = value.split(',');
    if (parts.length === 1) {
      setComposeProfileInput(value);
      setComposeProfileError('');
      return;
    }
    const pending = parts.pop() ?? '';
    for (const profile of parts) addComposeProfile(profile);
    setComposeProfileInput(pending);
  };

  const openComposeEditor = async (entry?: ContainerResourceEntry) => {
    const target = entry?.target ?? readyRuntimes().find((runtime) => runtime.engine === 'docker') ?? null;
    if (!target || !canRWX() || !canAdmin()) return;
    resetComposeEditor();
    setComposeEditorTarget(target);
    setComposeEditorOpen(true);
    const project = entry?.item as ComposeProjectInventoryItem | undefined;
    if (!project?.saved) return;
    setComposeEditorBusy(true);
    try {
      const definition = await getComposeProjectDefinition(project.project_id, target.engine, target.endpoint_id);
      setComposeEditingID(definition.project_id);
      setComposeName(definition.name);
      setComposeNameTouched(true);
      setComposeConfigPaths([...definition.config_paths]);
      setComposeEnvFilePath(definition.env_file_path ?? '');
      setComposeProfiles([...(definition.profiles ?? [])]);
    } catch (cause) {
      setComposeEditorOpen(false);
      notify.error(i18n.t('containers.notifications.composeLoadFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setComposeEditorBusy(false);
    }
  };

  const submitComposeEditor = async () => {
    const target = composeEditorTarget();
    const configPaths = composeConfigPaths();
    if (!target || target.engine !== 'docker' || !compact(composeName()) || configPaths.length === 0) return;
    const input = {
      engine: 'docker' as const,
      endpoint_id: target.endpoint_id,
      name: compact(composeName()).toLowerCase(),
      config_paths: configPaths,
      ...(compact(composeEnvFilePath()) ? { env_file_path: compact(composeEnvFilePath()) } : {}),
      profiles: composeProfiles(),
    };
    setComposeEditorBusy(true);
    try {
      if (composeEditingID()) await updateComposeProjectDefinition(composeEditingID(), input);
      else await createComposeProjectDefinition(input);
      setComposeEditorOpen(false);
      resetComposeEditor();
      await reloadConsole();
      notify.success(i18n.t('containers.notifications.composeSavedTitle'), i18n.t('containers.notifications.composeSavedMessage'));
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.composeSaveFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setComposeEditorBusy(false);
    }
  };

  const forgetComposeProject = async () => {
    const entry = composeForget();
    const project = entry?.item as ComposeProjectInventoryItem | undefined;
    if (!entry || !project?.saved) return;
    setComposeEditorBusy(true);
    try {
      await deleteComposeProjectDefinition(project.project_id);
      setComposeForget(null);
      if (selectedResourceKey() === entry.key) closeDetails();
      await reloadConsole();
      notify.success(i18n.t('containers.notifications.composeForgottenTitle'), i18n.t('containers.notifications.composeForgottenMessage'));
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.composeSaveFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setComposeEditorBusy(false);
    }
  };

  const loadRawInspect = async () => {
    const ready = readyConsole();
    const entry = selectedEntry();
    if (!ready || !entry || !canAdmin()) return;
    const identity = resourceIdentity(ready.target.view, entry.item);
    setRawInspectLoading(true);
    try {
      const value = await getRawContainerInspect(identity, entry.target.engine, entry.target.endpoint_id);
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
    const resource = selectedEntry();
    if (ready?.target.view !== 'volumes' || !resource) return;
    const identity = resourceIdentity('volumes', resource.item);
    try {
      const blob = await readContainerResourceFile('volumes', identity, entry.path, resource.target.engine, resource.target.endpoint_id);
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
              <Show when={detailString(image, 'reference') || (item as ContainerInventoryItem).image?.reference || (item as ContainerInventoryItem).image_id} fallback={<DetailRow label={i18n.t('containers.columns.image')} value="—" />} keyed>{(imageReference) => <DetailLinkRow label={i18n.t('containers.columns.image')} value={imageReference} onClick={() => { const entry = selectedEntry(); if (entry) openContainerImage(entry); }} />}</Show>
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
              <Show when={(item as ComposeProjectInventoryItem).saved}><DetailRow label={i18n.t('containers.compose.source')} value={(item as ComposeProjectInventoryItem).source || i18n.t('containers.compose.saved')} mono /></Show>
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
          <Show when={state !== 'running'}><Button size="sm" onClick={() => runAction('containers.start')} disabled={!canExecute()}><ActionGlyph method="containers.start" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button></Show>
          <Show when={containerExecAvailable()}><Button size="sm" onClick={() => openExecTab()}><Terminal class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.exec.open')}</Button></Show>
          <Show when={state === 'running'}><Button size="sm" variant="outline" onClick={() => runAction('containers.stop')} disabled={!canExecute()}><ActionGlyph method="containers.stop" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button></Show>
          <Button size="sm" variant="outline" onClick={() => runAction('containers.restart')} disabled={!canExecute()}><ActionGlyph method="containers.restart" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button>
          <Show when={state === 'running'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.pause')} disabled={!canExecute()}><ActionGlyph method="containers.pause" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.pause')}</Button></Show>
          <Show when={state === 'paused'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.unpause')} disabled={!canExecute()}><ActionGlyph method="containers.unpause" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.resume')}</Button></Show>
          <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('containers.kill')} disabled={!canExecute() || !canAdmin()}><ActionGlyph method="containers.kill" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.kill')}</Button>
          <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('containers.remove')} disabled={!canRWX() || !canAdmin()}><ActionGlyph method="containers.remove" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
        </>
      );
    }
    if (view() === 'images') return (
      <>
        <Button size="sm" onClick={runSelectedImage} disabled={!canRWX() || Boolean(pendingContainerCreateOperationID())}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.run')}</Button>
        <Button size="sm" variant="outline" onClick={() => openCreation('image-tag')} disabled={!canRWX()}>{i18n.t('containers.actions.tag')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('images.remove')} disabled={!canRWX() || !canAdmin()}><ActionGlyph method="images.remove" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
      </>
    );
    if (view() === 'volumes') return <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('volumes.remove')} disabled={!canRWX() || !canAdmin()}><ActionGlyph method="volumes.remove" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>;
    if (view() === 'compose-projects') return (
      <>
        <Button size="sm" onClick={() => runAction('compose.projects.start')} disabled={!canExecute()}><ActionGlyph method="compose.projects.start" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.stop')} disabled={!canExecute()}><ActionGlyph method="compose.projects.stop" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.restart')} disabled={!canExecute()}><ActionGlyph method="compose.projects.restart" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('compose.projects.down')} disabled={!canRWX() || !canAdmin()}><ActionGlyph method="compose.projects.down" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.down')}</Button>
        <Show when={(selected() as ComposeProjectInventoryItem).saved}>
          <Button size="sm" variant="ghost" onClick={() => { const entry = selectedEntry(); if (entry) void openComposeEditor(entry); }} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.compose.edit')}</Button>
          <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => { const entry = selectedEntry(); if (entry) setComposeForget(entry); }} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.compose.forget')}</Button>
        </Show>
      </>
    );
    return (
      <>
        <Button size="sm" onClick={() => runAction('pods.start')} disabled={!canExecute()}><ActionGlyph method="pods.start" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.stop')} disabled={!canExecute()}><ActionGlyph method="pods.stop" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.restart')} disabled={!canExecute()}><ActionGlyph method="pods.restart" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" class="container-destructive-action" onClick={() => runAction('pods.remove')} disabled={!canRWX() || !canAdmin()}><ActionGlyph method="pods.remove" class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
      </>
    );
  };

  const renderRowOverflow = (entry: ContainerResourceEntry) => {
    const item = entry.item;
    const operationDisabled = (method: string) => {
      if (method === 'containers.kill') return !canExecute() || !canAdmin();
      if (method === 'containers.remove' || method === 'images.remove' || method === 'volumes.remove' || method === 'compose.projects.down' || method === 'pods.remove') {
        return !canRWX() || !canAdmin();
      }
      return !canExecute();
    };
    const menuItem = (method: string): DropdownItem => {
      const presentation = actionPresentation(method);
      return {
        id: method,
        label: operationLabel(method),
        disabled: operationDisabled(method),
        icon: () => <ActionGlyph method={method} class={`h-3.5 w-3.5 ${presentation.destructive ? 'text-destructive' : ''}`} />,
      };
    };
    const items = (): DropdownItem[] => {
      if (view() === 'containers') return [
        menuItem('containers.restart'),
        menuItem((item as ContainerInventoryItem).state === 'paused' ? 'containers.unpause' : 'containers.pause'),
        menuItem('containers.kill'),
        menuItem('containers.remove'),
      ];
      if (view() === 'images') return [menuItem('images.remove')];
      if (view() === 'volumes') return [menuItem('volumes.remove')];
      if (view() === 'compose-projects') {
        const project = item as ComposeProjectInventoryItem;
        return [
          menuItem('compose.projects.restart'),
          menuItem('compose.projects.down'),
          ...(project.saved ? [
            { id: 'compose.definition.edit', label: i18n.t('containers.compose.edit'), disabled: !canRWX() || !canAdmin(), icon: () => <FileText class="h-3.5 w-3.5" /> },
            { id: 'compose.definition.forget', label: i18n.t('containers.compose.forget'), disabled: !canRWX() || !canAdmin(), icon: () => <Trash class="h-3.5 w-3.5 text-destructive" /> },
          ] satisfies DropdownItem[] : []),
        ];
      }
      return [menuItem('pods.restart'), menuItem('pods.remove')];
    };
    return (
      <div class="container-row-menu" onClick={(event) => event.stopPropagation()}>
        <Dropdown
          align="end"
          items={items()}
          onSelect={(method) => runRowMenuAction(entry, method)}
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

  const statsForContainer = (entry: ContainerResourceEntry): ContainerStats | undefined => {
    const item = entry.item as ContainerInventoryItem;
    const prefix = `${runtimeKey(entry.target)}\u0000`;
    const direct = collectionStats().get(`${prefix}${item.container_id}`);
    if (direct) return direct;
    return [...collectionStats()].find(([key, sample]) => key.startsWith(prefix) && (item.container_id.startsWith(sample.container_id) || sample.container_id.startsWith(item.container_id)))?.[1];
  };

  const detailTabs = createMemo<DetailTab[]>(() => {
    if (view() === 'containers') {
      const tabs: DetailTab[] = ['overview', 'logs', 'inspect', 'mounts'];
      if (containerExecAvailable()) tabs.push('exec');
      tabs.push('stats');
      return tabs;
    }
    if (view() === 'images') return ['overview', 'layers', 'used-by'];
    if (view() === 'volumes') return selectedTarget()?.capabilities?.volume_files ? ['overview', 'files', 'used-by'] : ['overview', 'used-by'];
    return ['overview', 'containers'];
  });

  const detailTabLabel = (tab: DetailTab) => i18n.t(`containers.detailTabs.${tab}` as Parameters<typeof i18n.t>[0]);
  const resourceTabItems = createMemo<TabItem[]>(() => availableViews().map((item) => ({
    id: item,
    label: viewLabel(item),
    icon: <ViewIcon view={item} class="h-4 w-4" />,
    disabled: consoleState().phase !== 'ready',
  })));
  const detailTabItems = createMemo<TabItem[]>(() => detailTabs().map((tab) => ({
    id: tab,
    label: detailTabLabel(tab),
  })));

  createEffect(() => {
    if (selected() && !detailTabs().includes(detailTab())) setDetailTab('overview');
  });

  const selectResourceView = (nextView: ContainerResourceView) => {
    const state = consoleState();
    if (state.phase !== 'ready' || state.target.view === nextView) return;
    relatedNavigationOrigin = null;
    void loadConsole(
      { view: nextView, selectedResourceKey: '' },
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
                const target = selectedTarget();
                if (!ready || !target) return;
                void loadConsole(
                  { view: 'containers', selectedResourceKey: '' },
                  {
                    resetListControls: true,
                    navigation: { engine: target.engine, endpointID: target.endpoint_id, selectedIdentity: identity },
                  },
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
      const namedVolumes = mounts.map(detailRecord).filter((mount) => detailString(mount, 'source_kind') === 'named_volume' && detailString(mount, 'source'));
      const otherMounts = mounts.map(detailRecord).filter((mount) => detailString(mount, 'source_kind') !== 'named_volume' || !detailString(mount, 'source'));
      const mountMeta = (mount: DetailRecord) => `${detailString(mount, 'target') || '—'} · ${detailBoolean(mount, 'read_only') ? i18n.t('containers.detail.readOnly') : i18n.t('containers.detail.readWrite')}`;
      return <div class="container-mount-groups"><Show when={mounts.length > 0} fallback={<div class="container-empty-inline">{i18n.t('containers.detail.emptyMounts')}</div>}><Show when={namedVolumes.length > 0}><section><h3>{i18n.t('containers.detail.namedVolumes')}</h3><div class="container-reference-list"><For each={namedVolumes}>{(mount) => <button type="button" class="container-mount-row container-mount-row--link" onClick={() => openNamedVolume(detailString(mount, 'source'))}><Database class="h-4 w-4" /><div><strong>{detailString(mount, 'source')}</strong><span>{mountMeta(mount)}</span></div><ChevronRight class="ml-auto h-3.5 w-3.5" /></button>}</For></div></section></Show><Show when={otherMounts.length > 0}><section><h3>{i18n.t('containers.detail.otherMounts')}</h3><div class="container-reference-list"><For each={otherMounts}>{(mount) => <div class="container-mount-row"><Folder class="h-4 w-4" /><div><strong>{detailString(mount, 'target') || '—'}</strong><span>{detailString(mount, 'type')} · {detailString(mount, 'source_kind') || i18n.t('containers.detail.redacted')}</span></div></div>}</For></div></section></Show></Show></div>;
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
    return null;
  };

  const renderExecPanel = () => (
    <section class="container-exec-panel" data-active={detailTab() === 'exec' ? 'true' : 'false'} aria-hidden={detailTab() === 'exec' ? undefined : 'true'}>
      <div class="container-exec-toolbar">
        <div class="container-exec-programs" role="group" aria-label={i18n.t('containers.exec.shell')}>
          <For each={['/bin/sh', '/bin/bash', '/bin/ash']}>{(program) => (
            <Button size="sm" variant={execPreset() === program ? 'default' : 'outline'} onClick={() => chooseExecProgram(program)} disabled={execBusy()}>{program.replace('/bin/', '')}</Button>
          )}</For>
          <Button size="sm" variant={execPreset() === 'custom' ? 'default' : 'outline'} onClick={() => setExecPreset('custom')} disabled={execBusy()}>{i18n.t('containers.exec.custom')}</Button>
        </div>
        <Show when={execSessionID()}><Button size="sm" variant="ghost" onClick={() => void closeExecSession()} disabled={execBusy()}><X class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.exec.close')}</Button></Show>
      </div>
      <Show when={execPreset() === 'custom'}>
        <div class="container-exec-custom">
          <label><span>{i18n.t('containers.exec.executable')}</span><Input value={execExecutable()} onInput={(event) => setExecExecutable(event.currentTarget.value)} placeholder="/usr/bin/env" /></label>
          <div class="container-exec-arguments">
            <span>{i18n.t('containers.exec.arguments')}</span>
            <For each={execArguments()}>{(argument) => <div><Input value={argument.value} onInput={(event) => setExecArguments((current) => current.map((item) => item.id === argument.id ? { ...item, value: event.currentTarget.value } : item))} placeholder="bash" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => setExecArguments((current) => current.filter((item) => item.id !== argument.id))}><X class="h-3.5 w-3.5" /></Button></div>}</For>
            <Button size="sm" variant="ghost" onClick={() => setExecArguments((current) => [...current, { id: containerRunRowID('exec-arg'), value: '' }])}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.exec.addArgument')}</Button>
          </div>
          <Button size="sm" onClick={runCustomExecProgram} disabled={execBusy() || !compact(execExecutable())}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.exec.connect')}</Button>
        </div>
      </Show>
      <Show when={execError()}><div class="container-exec-error" role="alert"><AlertTriangle class="h-4 w-4" /><span>{execError()}</span><Button size="sm" variant="outline" onClick={() => void startExecSession([compact(execExecutable()) || '/bin/sh', ...containerRunArgv(execArguments())])}>{i18n.t('containers.actions.retry')}</Button></div></Show>
      <Show when={execBusy()}><div class="container-exec-waiting"><Refresh class="h-4 w-4 animate-spin motion-reduce:animate-none" />{i18n.t('containers.exec.connecting')}</div></Show>
      <Show when={execSessionID()} keyed>{(sessionID) => <ContainerExecTerminal sessionID={sessionID} name={`${resourceName('containers', selected()!)} · Exec`} active={() => detailTab() === 'exec'} onSessionGone={() => { setExecSessionID(''); setExecError(i18n.t('containers.exec.sessionEnded')); }} />}</Show>
      <Show when={!execSessionID() && !execBusy() && !execError()}><div class="container-exec-empty"><Terminal class="h-6 w-6" /><strong>{i18n.t('containers.exec.ready')}</strong><span>{i18n.t('containers.exec.readyHint')}</span></div></Show>
    </section>
  );

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
        <Show when={!pending && managedResourceCount() > 0}>
          <button type="button" aria-pressed={resourceFilter() === 'managed'} onClick={() => setResourceFilter('managed')}>
            <Lock class="h-3.5 w-3.5" />
            <span>{filterLabel('managed')}</span>
            <span class="container-filter-count">{managedResourceCount()}</span>
          </button>
        </Show>
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
            triggerAriaLabel={i18n.t('containers.columns.filter')}
            trigger={(
              <button type="button" class="container-icon-action inline-flex items-center justify-center" title={i18n.t('containers.columns.filter')}>
                <Filter class="h-4 w-4" />
              </button>
            )}
          />
        </div>
        <Show when={view() === 'containers' && (pending || readyRuntimes().some((runtime) => runtime.capabilities?.collection_stats))}><Button size="sm" variant="ghost" onClick={() => setChartsOpen(!chartsOpen())} aria-pressed={!pending && chartsOpen()} disabled={pending}><Activity class="mr-1.5 h-3.5 w-3.5" />{chartsOpen() ? i18n.t('containers.detail.hideCharts') : i18n.t('containers.detail.showCharts')}</Button></Show>
        <Show when={view() === 'images' || view() === 'volumes'}>
          <Dropdown
            align="end"
            disabled={pending}
            items={[{
              id: 'prune',
              label: i18n.t('containers.actions.prune'),
              icon: () => <Trash class="h-3.5 w-3.5" />,
              tone: 'danger',
              disabled: pending || !canRWX() || !canAdmin() || pruneCandidates().length === 0,
            }]}
            onSelect={(action) => {
              if (action === 'prune') prune();
            }}
            triggerAriaLabel={i18n.t('containers.prune.moreActions')}
            trigger={(
              <button type="button" class="container-icon-action inline-flex items-center justify-center" title={i18n.t('containers.prune.moreActions')}>
                <MoreVertical class="h-4 w-4" />
              </button>
            )}
          />
        </Show>
        <Show when={view() === 'containers'}><Button size="sm" onClick={() => openContainerRun()} disabled={pending || !canRWX() || Boolean(pendingContainerCreateOperationID())}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.container')}</Button></Show>
        <Show when={view() === 'images'}><Button size="sm" onClick={() => openCreation('image')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.image')}</Button></Show>
        <Show when={view() === 'volumes'}><Button size="sm" onClick={() => openCreation('volume')} disabled={pending || !canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.volume')}</Button></Show>
        <Show when={view() === 'compose-projects'}><Button size="sm" onClick={() => void openComposeEditor()} disabled={pending || !canRWX() || !canAdmin()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.compose.add')}</Button></Show>
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
      : i18n.t(permission ? 'containers.engineState.permissionDescription' : 'containers.engineState.unavailableDescription', { engine: runtimeSummary() });
    return (
      <div class="container-engine-state" data-container-engine-state={state.phase} role={state.phase === 'error' ? 'alert' : 'status'}>
        <div class="container-empty-state__mark">{permission || state.phase === 'error' ? <AlertTriangle class="h-6 w-6" /> : <Layers class="h-6 w-6" />}</div>
        <strong>{i18n.t(permission ? 'containers.engineState.permissionTitle' : 'containers.engineState.unavailableTitle', { engine: runtimeSummary() })}</strong>
        <Show when={state.runtimes.length > 0} fallback={<p>{message}</p>}>
          <div class="container-runtime-state-list">
            <For each={state.runtimes}>{(runtime) => <div><span>{runtimeName(runtime.engine)}</span><strong>{i18n.t(`containers.runtimeStates.${runtime.state}` as Parameters<typeof i18n.t>[0])}</strong></div>}</For>
          </div>
        </Show>
        <div class="flex gap-2"><Button size="sm" variant="outline" onClick={() => void reloadConsole(true)}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.engineState.retry')}</Button><Button size="sm" onClick={openContainerServices}>{i18n.t('containers.services.open')}</Button></div>
      </div>
    );
  };

  const serviceStateLabel = (state: ContainerService['state']) => i18n.t(`containers.services.states.${state}` as Parameters<typeof i18n.t>[0]);
  const serviceGuidance = (service: ContainerService) => service.guidance_code
    ? i18n.t(`containers.services.guidance.${service.guidance_code}` as Parameters<typeof i18n.t>[0], { engine: runtimeName(service.engine) })
    : '';

  const renderContainerServicesSkeleton = (): JSX.Element => (
    <div class="container-services-grid container-services-grid--loading" aria-label={i18n.t('containers.loading')}>
      <For each={[{ guidance: false, actions: 3 }, { guidance: true, actions: 1 }]}>{(item) => (
        <div class="container-service-card container-service-card--loading">
          <div class="container-service-card__mark"><span class="container-skeleton container-service-card__loading-brand" /></div>
          <span class="container-service-card__loading-identity"><span class="container-skeleton container-skeleton--name" /><span class="container-skeleton container-skeleton--secondary" /></span>
          <span class="container-skeleton container-service-card__loading-status" />
          <Show when={item.guidance}><span class="container-skeleton container-service-card__loading-guidance" /></Show>
          <span class="container-service-card__actions container-service-card__loading-actions"><For each={Array.from({ length: item.actions })}>{() => <span class="container-skeleton" />}</For></span>
        </div>
      )}</For>
    </div>
  );

  const renderContainerServicesPage = (): JSX.Element => (
    <section class="container-services-page" data-container-services-page aria-busy={containerServicesLoading()}>
      <header class="container-services-page__header">
        <Button size="sm" variant="ghost" class="container-icon-action" onClick={closeContainerServices} aria-label={i18n.t('containers.detail.back')}><ArrowLeft class="h-4 w-4" /></Button>
        <div><h2>{i18n.t('containers.services.title')}</h2><p>{i18n.t('containers.services.description')}</p></div>
      </header>
      <Show when={!containerServicesInitialLoading()} fallback={renderContainerServicesSkeleton()}>
        <Show when={!containerServicesError() || containerServices().length > 0} fallback={<div class="container-engine-state" role="alert"><AlertTriangle class="h-6 w-6" /><strong>{i18n.t('containers.services.loadFailed')}</strong><p>{containerServicesError()}</p><Button size="sm" variant="outline" onClick={() => void loadContainerServices()}>{i18n.t('containers.actions.retry')}</Button></div>}>
          <Show when={containerServicesError() && containerServices().length > 0}>
            <div class="container-services-refresh-error" role="status"><AlertTriangle class="h-4 w-4" /><div><strong>{i18n.t('containers.services.loadFailed')}</strong><small>{containerServicesError()}</small></div><Button size="sm" variant="outline" onClick={() => void loadContainerServices()}>{i18n.t('containers.actions.retry')}</Button></div>
          </Show>
          <div class="container-services-grid" data-refreshing={containerServicesLoading() ? 'true' : 'false'}>
            <For each={containerServices()}>{(service) => {
              const operation = () => serviceOperation(service.service_id);
              const active = () => operation() && operationActive(operation()!);
              const guidance = () => service.state !== 'running' || service.remote || service.configuration.mode === 'unavailable'
                ? serviceGuidance(service)
                : '';
              return <article class="container-service-card" data-state={service.state} data-active={active() ? 'true' : 'false'}>
                <div class="container-service-card__mark"><ContainerServiceBrandMark engine={service.engine} remote={service.remote} /></div>
                <div class="container-service-card__identity"><span>{runtimeName(service.engine)}</span><h3>{service.name}</h3><small>{i18n.t(`containers.services.implementations.${service.implementation}` as Parameters<typeof i18n.t>[0])}<Show when={service.version}> · {service.version}</Show><Show when={service.rootless}> · {i18n.t('containers.services.rootless')}</Show></small></div>
                <Tag variant={service.state === 'running' ? 'success' : service.state === 'error' || service.state === 'permission' ? 'error' : 'neutral'} tone="soft" size="sm">{serviceStateLabel(service.state)}</Tag>
                <Show when={service.restart_required}><div class="container-service-card__notice"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.services.restartRequired')}</div></Show>
                <Show when={guidance()}><p class="container-service-card__guidance">{guidance()}</p></Show>
                <Show when={operation()} keyed>{(item) => <button type="button" class="container-service-operation" data-state={item.state} onClick={() => openServiceOperation(item)}><span class={active() ? 'animate-pulse motion-reduce:animate-none' : ''} /><strong>{operationLabel(item.method)}</strong><small>{operationStateLabel(item.state)}</small><ChevronRight class="h-4 w-4" /></button>}</Show>
                <div class="container-service-card__actions">
                  <Show when={service.state !== 'running' && service.capabilities.start}><Button size="sm" onClick={() => runContainerServiceAction(service, 'start')} disabled={Boolean(active()) || !canRWX() || !canAdmin()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button></Show>
                  <Show when={service.state === 'running' && service.capabilities.stop}><Button size="sm" variant="outline" onClick={() => runContainerServiceAction(service, 'stop')} disabled={Boolean(active()) || !canRWX() || !canAdmin()}><StopFilled class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button></Show>
                  <Show when={service.state === 'running' && service.capabilities.restart}><Button size="sm" variant="outline" onClick={() => runContainerServiceAction(service, 'restart')} disabled={Boolean(active()) || !canRWX() || !canAdmin()}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button></Show>
                  <Button size="sm" variant="ghost" onClick={() => void openServiceConfiguration(service)} disabled={service.configuration.mode !== 'local' || Boolean(active()) || !canAdmin()} title={service.configuration.mode === 'local' ? undefined : serviceGuidance(service)}><Settings class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.services.configure')}</Button>
                </div>
              </article>;
            }}</For>
          </div>
        </Show>
      </Show>
    </section>
  );

  return (
    <div class={`redeven-containers flex h-full min-h-0 flex-col ${redevenSurfaceRoleClass('main')}`} data-container-page data-variant={props.variant ?? 'activity'}>
      <header class="container-command-header shrink-0 px-3 md:px-5">
        <div class="container-header-main">
          <div class="flex min-w-0 items-center gap-2.5">
            <div class="container-product-mark"><Layers class="h-5 w-5" aria-hidden="true" /></div>
            <h1 class="truncate text-base font-semibold tracking-tight">{i18n.t('containers.title')}</h1>
          </div>
          <div class="container-header-controls">
            <Button size="sm" variant="ghost" class="container-icon-action container-services-entry" onClick={openContainerServices} aria-label={i18n.t('containers.services.title')} title={i18n.t('containers.services.title')} aria-pressed={servicesOpen()}>
              <Settings class="h-4 w-4" aria-hidden="true" />
              <Show when={readyRuntimes().length > 0 && runtimeIssues().length > 0}><span class="container-services-entry__issue" aria-hidden="true" /></Show>
            </Button>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => void (servicesOpen() ? loadContainerServices() : reloadConsole(true))} disabled={servicesOpen() ? containerServicesLoading() : consoleBusy()} aria-label={i18n.t('containers.actions.refresh')} title={i18n.t('containers.actions.refresh')}><Refresh class={`h-4 w-4 ${(servicesOpen() ? containerServicesLoading() : consoleBusy()) ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>
            <Button size="sm" variant="ghost" class="container-icon-action" onClick={() => setOperationsOpen(true)} aria-label={i18n.t('containers.operations.title')} title={i18n.t('containers.operations.title')}>
              <Activity class="h-4 w-4" aria-hidden="true" />
              <Show when={activeOperationCount() > 0}><span class="container-operation-count">{activeOperationCount()}</span></Show>
            </Button>
          </div>
        </div>

        <Show when={!servicesOpen()}><Tabs
          class="container-resource-tabs"
          items={resourceTabItems()}
          activeId={view()}
          onChange={(id) => selectResourceView(id as ContainerResourceView)}
          size="md"
          ariaLabel={i18n.t('containers.resourceNavigation')}
          features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false, scrollButtons: 'auto' }}
          slotClassNames={{ scrollContainer: 'container-resource-tabs__scroller', tab: 'container-resource-tabs__tab' }}
        /></Show>
      </header>

      <main class="container-content min-h-0 flex-1 overflow-hidden" aria-busy={consoleBusy()}>
        <Show when={servicesOpen()} fallback={<Show when={readyConsole()} fallback={renderConsoleFallback()}>
        <Show when={selected()} keyed fallback={
          <div class="container-list-page">
            {renderInventoryToolbar()}
            <Show when={chartsOpen() && view() === 'containers'}><div class="container-metrics-strip"><div><span>{i18n.t('containers.stats.cpu')}</span><strong>{[...collectionStats().values()].reduce((sum, item) => sum + item.cpu_percent, 0).toFixed(1)}%</strong></div><div><span>{i18n.t('containers.stats.memory')}</span><strong>{formatBytes([...collectionStats().values()].reduce((sum, item) => sum + item.memory_bytes, 0))}</strong></div><div><span>{i18n.t('containers.filters.active')}</span><strong>{activeResourceCount()}</strong></div></div></Show>
            <div class="container-inventory-scroll" ref={(element) => { inventoryScrollElement = element; }}>
              <Show when={filteredInventory().length > 0} fallback={<div class="container-empty-state"><Search class="h-6 w-6" /><strong>{inventory().length ? i18n.t('containers.empty.filteredTitle') : i18n.t('containers.empty.title')}</strong></div>}>
                  <div class="container-resource-table-shell" data-container-table-shell>
                    <table class="w-full text-left text-sm" data-container-resource-table>
                      {renderInventoryTableHeader()}
                      <tbody><For each={filteredInventory()}>{(entry, index) => {
                        const item = () => entry.item;
                        const container = () => entry.item as ContainerInventoryItem;
                        const sample = () => view() === 'containers' ? statsForContainer(entry) : undefined;
                        return <tr tabindex={0} data-container-resource-row-index={index()} onClick={() => selectResource(entry)} onKeyDown={(event) => handleTableKey(event, index())}>
                          <td><Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), item()))}><span class="container-usage-dot" data-active={resourceActive(view(), item())} /></Show></td>
                          <td><div class="container-name-cell"><ViewIcon view={view()} class="h-4 w-4" /><span class="truncate">{resourceName(view(), item())}</span><Show when={view() === 'compose-projects' && (item() as ComposeProjectInventoryItem).saved}><span class="container-saved-project" title={(item() as ComposeProjectInventoryItem).source || i18n.t('containers.compose.saved')}><Check class="h-3 w-3" />{i18n.t('containers.compose.saved')}</span></Show><Show when={runtimeBadgeVisible(entry)}><span class="container-runtime-badge">{runtimeName(entry.target.engine)}</span></Show><Show when={resourceManagement(item())?.managed}><span class="container-managed-label" title={i18n.t('containers.managed.badge')}><Layers class="h-3.5 w-3.5" /></span></Show></div></td>
                          <Show when={showSecondaryColumn()}><td class="container-secondary-cell"><Show when={view() === 'containers'}><Show when={container().image_id || container().image?.reference || container().image?.digest} fallback="—"><button type="button" class="container-resource-link" onClick={(event) => { event.stopPropagation(); openContainerImage(entry); }}>{container().image?.reference || container().image?.digest || container().image_id}</button></Show></Show><Show when={view() === 'images'}>{formatBytes((item() as ImageInventoryItem).size_bytes)}</Show><Show when={view() === 'volumes'}>{(item() as VolumeInventoryItem).driver || '—'}</Show><Show when={view() === 'compose-projects' || view() === 'pods'}>{(item() as ComposeProjectInventoryItem | PodInventoryItem).running_count} / {(item() as ComposeProjectInventoryItem | PodInventoryItem).container_count}</Show></td></Show>
                          <Show when={view() === 'containers'}><Show when={showPortsColumn()}><td class="container-port-cell">{container().ports?.map(formatPort).filter(Boolean).slice(0, 2).join(', ') || '—'}</td></Show><Show when={chartsOpen()}><td class="tabular-nums">{sample() ? `${sample()!.cpu_percent.toFixed(1)}%` : '—'}</td><td class="tabular-nums">{formatBytes(sample()?.memory_bytes)}</td></Show></Show>
                          <Show when={view() !== 'containers' && showCreatedColumn()}><td>{formatDate((item() as ImageInventoryItem | VolumeInventoryItem | PodInventoryItem).created_at_unix_ms)}</td></Show>
                          <td><div class="container-row-actions"><Show when={resourceManagement(item())?.managed} fallback={<><Show when={view() === 'containers' && compact(container().state).toLowerCase() === 'running' && entry.target.capabilities?.exec}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.exec.open')} disabled={!canExecute()} onClick={(event) => { event.stopPropagation(); openExecTab(entry); }}><Terminal class="h-4 w-4" /></Button></Show><Show when={view() === 'containers'}>{(() => { const method = resourceActive(view(), item()) ? 'containers.stop' : 'containers.start'; return <Button size="sm" variant="ghost" class="container-icon-action" aria-label={operationLabel(method)} disabled={!canExecute()} onClick={(event) => runRowAction(event, entry, method)}><ActionGlyph method={method} class="h-4 w-4" /></Button>; })()}</Show><Show when={view() === 'images'}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.actions.run')} disabled={!canRWX() || Boolean(pendingContainerCreateOperationID())} onClick={(event) => openImageRun(event, entry)}><Play class="h-4 w-4" /></Button></Show><Show when={view() === 'compose-projects'}>{(() => { const method = resourceActive(view(), item()) ? 'compose.projects.stop' : 'compose.projects.start'; return <Button size="sm" variant="ghost" class="container-icon-action" aria-label={operationLabel(method)} disabled={!canExecute()} onClick={(event) => runRowAction(event, entry, method)}><ActionGlyph method={method} class="h-4 w-4" /></Button>; })()}</Show><Show when={view() === 'pods'}>{(() => { const method = resourceActive(view(), item()) ? 'pods.stop' : 'pods.start'; return <Button size="sm" variant="ghost" class="container-icon-action" aria-label={operationLabel(method)} disabled={!canExecute()} onClick={(event) => runRowAction(event, entry, method)}><ActionGlyph method={method} class="h-4 w-4" /></Button>; })()}</Show>{renderRowOverflow(entry)}<ChevronRight class="h-4 w-4 text-muted-foreground" /></>}><Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); selectResource(entry); queueMicrotask(openManagedService); }}><ExternalLink class="h-4 w-4" /></Button></Show></div></td>
                        </tr>;
                      }}</For></tbody>
                    </table>
                  </div>
                  <div class="container-mobile-list" data-container-mobile-list><For each={filteredInventory()}>{(entry) => <button type="button" class="container-mobile-card" onClick={() => selectResource(entry)}><span class="container-resource-icon" data-tone={resourceStatusTone(resourceStatus(view(), entry.item))}><ViewIcon view={view()} class="h-4 w-4" /></span><span class="min-w-0 flex-1"><strong>{resourceName(view(), entry.item)}</strong><small>{view() === 'containers' ? (entry.item as ContainerInventoryItem).image?.reference || '—' : secondaryColumnLabel()}</small></span><Show when={view() === 'images' || view() === 'volumes'} fallback={renderStatus(resourceStatus(view(), entry.item))}><span class="text-xs">{Number(resourceStatus(view(), entry.item))}</span></Show><ChevronRight class="h-4 w-4" /></button>}</For></div>
              </Show>
            </div>
          </div>
        }>{(item) => <article class="container-detail-page" data-container-detail-page><div class="container-detail-header"><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.detail.back')} onClick={closeDetails}><ArrowLeft class="h-4 w-4" /></Button><div class="container-resource-icon container-resource-icon--large" data-tone={resourceStatusTone(resourceStatus(view(), item))}><ViewIcon view={view()} class="h-4 w-4" /></div><div class="container-detail-identity"><span>{viewLabel(view())}</span><h2>{resourceName(view(), item)}</h2><small>{resourceIdentity(view(), item).slice(0, 24)}</small></div><Show when={view() !== 'images' && view() !== 'volumes'}>{renderStatus(resourceStatus(view(), item))}</Show><div class="container-detail-actions"><Show when={selectedManagedOwner()} keyed>{(owner) => <Button size="sm" variant="outline" onClick={openManagedService}><ExternalLink class="mr-1.5 h-3.5 w-3.5" />{owner.name}</Button>}</Show><Show when={!selectedManagedOwner()}>{renderResourceActions()}</Show></div></div><Tabs class="container-detail-tabs" items={detailTabItems()} activeId={detailTab()} onChange={(id) => selectDetailTab(id as DetailTab)} size="md" ariaLabel={viewLabel(view())} features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false, scrollButtons: 'auto' }} slotClassNames={{ scrollContainer: 'container-detail-tabs__scroller', tab: 'container-detail-tabs__tab' }} /><div class="container-detail-body"><Show when={detailTab() !== 'exec'}>{renderDetailContent()}</Show><Show when={view() === 'containers' && containerExecAvailable()}>{renderExecPanel()}</Show></div></article>}</Show>
        </Show>}>{renderContainerServicesPage()}</Show>
      </main>

      <EnvAppDrawer open={operationsOpen()} onOpenChange={setOperationsOpen} title={i18n.t('containers.operations.title')} description={i18n.t('containers.operations.description')} bodyClass="min-h-0">
        <div class="container-operations-workspace" data-container-operations>
          <Show when={operations().length > 0} fallback={<div class="py-12 text-center text-sm text-muted-foreground">{i18n.t('containers.operations.empty')}</div>}>
            <div class="container-operation-list" role="listbox" aria-label={i18n.t('containers.operations.title')}>
              <For each={operations()}>{(operation) => <button type="button" role="option" aria-selected={selectedOperationID() === operation.operation_id} class="container-operation-card" data-state={operation.state} onClick={() => setSelectedOperationID(operation.operation_id)}><span class="container-operation-card__state" aria-hidden="true" /><span class="min-w-0 flex-1 text-left"><strong>{operationLabel(operation.method)}</strong><small class="font-mono">{operation.resource_identity}</small><small>{i18n.formatRelativeTime(operation.updated_at_unix_ms)}</small></span><Tag variant={operation.state === 'succeeded' ? 'success' : operation.state === 'failed' || operation.state === 'interrupted' ? 'error' : 'neutral'} tone="soft" size="sm">{operationStateLabel(operation.state)}</Tag></button>}</For>
            </div>
            <Show when={selectedOperation()} keyed>{(operation) => {
              const progress = () => latestOperationProgress();
              const phase = () => operationActive(operation) ? (progress().phase || operation.state) : operation.state;
              const percent = () => progress().total > 0 ? Math.max(0, Math.min(100, (progress().current / progress().total) * 100)) : 0;
              return <section class="container-operation-detail" data-state={operation.state}>
                <header><div><span>{operationLabel(operation.method)}</span><h3>{operation.resource_identity}</h3></div><Tag variant={operation.state === 'succeeded' ? 'success' : operation.state === 'failed' || operation.state === 'interrupted' ? 'error' : 'neutral'} tone="soft" size="sm">{operationStateLabel(operation.state)}</Tag></header>
                <div class="container-operation-progress" data-indeterminate={operationActive(operation) && progress().total === 0 ? 'true' : 'false'}>
                  <div><strong>{operationPhaseLabel(phase())}</strong><Show when={operationActive(operation) && progress().total > 0}><span>{progress().summary}</span></Show></div>
                  <div class="container-operation-progress__track" role="progressbar" aria-label={operationPhaseLabel(phase())} aria-valuemin={0} aria-valuemax={operationActive(operation) && progress().total ? progress().total : 100} aria-valuenow={operation.state === 'succeeded' ? 100 : operationActive(operation) && progress().total ? progress().current : undefined}><span style={{ width: operation.state === 'succeeded' ? '100%' : progress().total ? `${percent()}%` : undefined }} /></div>
                </div>
                <dl class="container-operation-facts"><div><dt>{i18n.t('containers.operations.service')}</dt><dd>{runtimeName(operation.engine)}</dd></div><div><dt>{i18n.t('containers.operations.duration')}</dt><dd>{operationDuration(operation)}</dd></div><div><dt>{i18n.t('containers.operations.started')}</dt><dd>{formatDate(operation.started_at_unix_ms || operation.created_at_unix_ms)}</dd></div></dl>
                <Show when={operation.error_message}><div class="container-operation-error" role="alert"><AlertTriangle class="h-4 w-4" /><div><strong>{i18n.t('containers.operations.errorTitle')}</strong><p>{operation.error_message}</p><Show when={operation.error_code}><code>{operation.error_code}</code></Show></div></div></Show>
                <div class="container-operation-timeline"><h4>{i18n.t('containers.operations.progressTitle')}</h4><Show when={!operationEventsLoading()} fallback={<div class="container-operation-timeline__loading">{i18n.t('containers.operations.loadingProgress')}</div>}><For each={operationEvents()}>{(event) => { const item = progressFromEvent(event); return <div class="container-operation-step" data-state={event.state}><span aria-hidden="true">{TERMINAL_OPERATION_STATES.has(event.state) && event.state !== 'succeeded' ? <X class="h-3 w-3" /> : <Check class="h-3 w-3" />}</span><div><strong>{operationPhaseLabel(item.phase)}</strong><Show when={item.total > 0}><small>{item.summary}</small></Show></div><time>{i18n.formatRelativeTime(event.created_at_unix_ms)}</time></div>; }}</For></Show></div>
                <Show when={operationActive(operation)}><div class="container-operation-detail__actions"><Button size="sm" variant="outline" onClick={() => void cancelContainerOperation(operation.operation_id).then(loadOperations)} disabled={!canExecute()}>{i18n.t('containers.actions.cancel')}</Button></div></Show>
              </section>;
            }}</Show>
          </Show>
        </div>
      </EnvAppDrawer>

      <Dialog
        open={serviceConfigurationOpen()}
        onOpenChange={(open) => { if (!open && !serviceConfigurationLoading()) setServiceConfigurationOpen(false); }}
        title={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })}
        class="container-service-configuration-dialog"
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setServiceConfigurationOpen(false)}>{i18n.t('containers.actions.close')}</Button><Show when={serviceConfigurationTarget()?.configuration.mode === 'local'}><Button size="sm" variant="outline" onClick={() => submitServiceConfiguration('save')} disabled={!serviceConfigurationSourceEditable() || serviceConfigurationLoading() || !canRWX() || !canAdmin()}>{i18n.t('containers.services.save')}</Button><Show when={serviceConfigurationSource()?.apply_modes.includes('save_and_restart')}><Button size="sm" onClick={() => submitServiceConfiguration('save_and_restart')} disabled={!serviceConfigurationSourceEditable() || serviceConfigurationLoading() || !serviceConfigurationTarget()?.capabilities.restart || !canRWX() || !canAdmin()}>{i18n.t('containers.services.saveRestart')}</Button></Show></Show></div>}
      >
        <Show when={serviceConfigurationTarget()?.configuration.mode === 'local'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t('containers.services.configurationUnavailable')}</strong><p>{serviceConfigurationTarget() ? serviceGuidance(serviceConfigurationTarget()!) : ''}</p></div>}>
          <Show when={!serviceConfigurationLoading()} fallback={<div class="container-service-config-loading"><Refresh class="h-4 w-4 animate-spin motion-reduce:animate-none" />{i18n.t('containers.loading')}</div>}>
            <Show when={serviceConfiguration()} fallback={<div class="container-service-config-error" role="alert"><AlertTriangle class="h-4 w-4" />{serviceConfigurationError()}</div>}>
              <Tabs class="container-service-config-source-tabs" items={(serviceConfiguration()?.sources ?? []).map((source) => ({ id: source.source_id, label: i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLI' : 'containers.services.engineConfiguration') }))} activeId={serviceConfigurationSourceID()} onChange={(id) => selectServiceConfigurationSource(id as ContainerServiceConfigurationSourceID)} size="md" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false }} />
              <Show when={serviceConfigurationSource()} keyed>{(source) => <>
                <div class="container-service-config-source-meta">
                  <div><span>{i18n.t('containers.services.configurationPath')}</span><code>{source.display_path}</code></div>
                  <Tag variant={source.status === 'ready' ? 'success' : source.status === 'missing' ? 'neutral' : 'error'} tone="soft" size="sm">{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</Tag>
                </div>
                <Show when={source.status === 'missing'}><div class="container-service-config-note"><Info class="h-4 w-4" />{i18n.t('containers.services.fileWillBeCreated')}</div></Show>
                <Show when={source.status === 'invalid'}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLIInvalid' : 'containers.services.configurationInvalid')}</div></Show>
                <Show when={source.status !== 'permission' && source.status !== 'unsupported'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</strong></div>}>
                  <Show when={serviceConfigurationSections().length > 1}><Tabs class="container-service-config-tabs" items={serviceConfigurationSections().map((section) => ({ id: section, label: i18n.t(section === 'general' ? 'containers.services.general' : section === 'proxy' ? 'containers.services.proxies' : section === 'credentials' ? 'containers.services.credentials' : 'containers.services.advanced') }))} activeId={serviceConfigurationMode()} onChange={(id) => setServiceConfigurationMode(id as ContainerServiceConfigurationSection)} size="sm" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'activeBorder', thicknessPx: 2, colorToken: 'primary', animated: false }, containerBorder: false }} /></Show>
                  <Show when={source.source_id === 'docker_cli'} fallback={<Show when={serviceConfigurationMode() === 'proxy'} fallback={<div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: source.format, wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={(content) => updateServiceConfigurationDraft({ content })} saveError={serviceConfigurationError()} /></div>}><div class="container-service-proxy-form"><label><span>{i18n.t('containers.services.httpProxy')}</span><Input value={serviceConfigurationDraft()?.httpProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ httpProxy: event.currentTarget.value })} placeholder="http://proxy.example.com:3128" autocomplete="off" /></label><label><span>{i18n.t('containers.services.httpsProxy')}</span><Input value={serviceConfigurationDraft()?.httpsProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ httpsProxy: event.currentTarget.value })} placeholder="https://proxy.example.com:3129" autocomplete="off" /></label><label><span>{i18n.t('containers.services.noProxy')}</span><Input value={serviceConfigurationDraft()?.noProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ noProxy: event.currentTarget.value })} placeholder="localhost,127.0.0.1,.example.com" autocomplete="off" /></label></div></Show>}>
                    <Show when={dockerCLIConfigurationDocument()} keyed>{(document) => <>
                      <Show when={serviceConfigurationMode() === 'general'}>
                        <div class="container-service-cli-form">
                          <div class="container-service-cli-intro"><Info class="h-4 w-4" aria-hidden="true" /><p>{i18n.t('containers.services.dockerCLIScope')}</p></div>
                          <div class="container-service-cli-common-grid">
                            <label class="container-service-cli-setting-card"><span class="container-service-cli-setting-card__heading"><Layers class="h-4 w-4" aria-hidden="true" /><span><strong>{i18n.t('containers.services.currentContext')}</strong><code>currentContext</code></span></span><Select value={dockerCLIString(document, 'currentContext') || 'default'} onChange={(value) => setDockerCLIString('currentContext', value)} options={Array.from(new Set(['default', ...(source.context_options ?? []), dockerCLIString(document, 'currentContext')].filter(Boolean))).map((value) => ({ value, label: value }))} /></label>
                            <label class="container-service-cli-setting-card"><span class="container-service-cli-setting-card__heading"><Terminal class="h-4 w-4" aria-hidden="true" /><span><strong>{i18n.t('containers.services.detachKeys')}</strong><code>detachKeys</code></span></span><Input value={dockerCLIString(document, 'detachKeys')} onInput={(event) => setDockerCLIString('detachKeys', event.currentTarget.value)} placeholder={i18n.t('containers.services.detachKeysPlaceholder')} autocomplete="off" /></label>
                          </div>
                          <Show when={source.context_overridden_by}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.services.contextOverridden', { variable: source.context_overridden_by ?? '' })}</div></Show>
                          <details class="container-service-cli-disclosure">
                            <summary><span class="container-service-cli-disclosure__mark"><FileText class="h-4 w-4" aria-hidden="true" /></span><span class="container-service-cli-disclosure__copy"><strong>{i18n.t('containers.services.outputFormats')}</strong><small>{i18n.t('containers.services.outputFormatsDescription')}</small></span><Tag tone="soft" size="sm">{customizedDockerCLIOutputFormatCount()}/{dockerCLIOutputFormats.length}</Tag><ChevronRight class="container-service-cli-disclosure__chevron h-4 w-4" aria-hidden="true" /></summary>
                            <div class="container-service-cli-output-grid"><For each={dockerCLIOutputFormats}>{(format) => <label><span><strong>{format.command}</strong><code>{format.key}</code></span><Input value={dockerCLIString(document, format.key)} onInput={(event) => setDockerCLIString(format.key, event.currentTarget.value)} placeholder={i18n.t('containers.services.outputFormatPlaceholder')} autocomplete="off" /></label>}</For></div>
                          </details>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'proxy'}>
                        <div class="container-service-cli-section">
                          <div class="container-service-cli-section__heading"><div><strong>{i18n.t('containers.services.proxyProfiles')}</strong><p>{i18n.t('containers.services.dockerCLIProxyScope')}</p></div><div class="container-service-cli-heading-actions"><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t(serviceConfigurationSecretsVisible() ? 'containers.run.hideValue' : 'containers.run.showValue')} onClick={() => setServiceConfigurationSecretsVisible((visible) => !visible)}>{serviceConfigurationSecretsVisible() ? <EyeOff class="h-3.5 w-3.5" /> : <Eye class="h-3.5 w-3.5" />}</Button><Button size="sm" variant="outline" onClick={() => addDockerCLIMapEntry('proxies', Object.keys(jsonObject(document.proxies) ?? {}).length === 0 ? 'default' : 'https://docker.example.com:2376', {})}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.services.addProfile')}</Button></div></div>
                          <For each={Object.entries(jsonObject(document.proxies) ?? {})}>{(entry) => { const target = () => entry[0]; const profile = () => jsonObject(entry[1]) ?? {}; return <section class="container-service-cli-profile"><header><Input value={target()} onChange={(event) => setDockerCLIMapEntry('proxies', target(), event.currentTarget.value, profile())} aria-label={i18n.t('containers.services.proxyTarget')} /><Button size="sm" variant="ghost" class="container-icon-action container-destructive-action" aria-label={i18n.t('containers.services.removeProfile')} onClick={() => removeDockerCLIMapEntry('proxies', target())}><Trash class="h-3.5 w-3.5" /></Button></header><div class="container-service-cli-grid"><For each={['httpProxy', 'httpsProxy', 'ftpProxy', 'allProxy', 'noProxy'] as const}>{(key) => <label><span>{i18n.t(`containers.services.proxyFields.${key}` as Parameters<typeof i18n.t>[0])}</span><Input type={key === 'noProxy' || serviceConfigurationSecretsVisible() ? 'text' : 'password'} value={typeof profile()[key] === 'string' ? profile()[key] as string : ''} onInput={(event) => setDockerCLIMapEntry('proxies', target(), target(), objectWithString(profile(), key, event.currentTarget.value))} placeholder={i18n.t(key === 'noProxy' ? 'containers.services.proxyBypassPlaceholder' : 'containers.services.proxyURLPlaceholder')} autocomplete="new-password" /></label>}</For></div></section>; }}</For>
                          <Show when={Object.keys(jsonObject(document.proxies) ?? {}).length === 0}><div class="container-service-cli-empty">{i18n.t('containers.services.noProxyProfiles')}</div></Show>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'credentials'}>
                        <div class="container-service-cli-section">
                          <p class="container-service-config-lead">{i18n.t('containers.services.credentialsScope')}</p>
                          <label class="container-service-cli-field"><span>{i18n.t('containers.services.credentialStore')}</span><Input value={dockerCLIString(document, 'credsStore')} onInput={(event) => setDockerCLIString('credsStore', event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} autocomplete="off" /></label>
                          <div class="container-service-cli-section__heading"><strong>{i18n.t('containers.services.credentialHelpers')}</strong><Button size="sm" variant="outline" onClick={() => addDockerCLIMapEntry('credHelpers', 'registry.example.com', '')}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.services.addHelper')}</Button></div>
                          <div class="container-service-cli-pairs"><For each={Object.entries(jsonObject(document.credHelpers) ?? {})}>{(entry) => <div><Input value={entry[0]} onChange={(event) => setDockerCLIMapEntry('credHelpers', entry[0], event.currentTarget.value, entry[1])} aria-label={i18n.t('containers.services.registry')} /><Input value={typeof entry[1] === 'string' ? entry[1] as string : ''} onInput={(event) => setDockerCLIMapEntry('credHelpers', entry[0], entry[0], event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} aria-label={i18n.t('containers.services.credentialHelper')} /><Button size="sm" variant="ghost" class="container-icon-action container-destructive-action" aria-label={i18n.t('containers.services.removeHelper')} onClick={() => removeDockerCLIMapEntry('credHelpers', entry[0])}><Trash class="h-3.5 w-3.5" /></Button></div>}</For></div>
                          <div class="container-service-protected-registries"><strong>{i18n.t('containers.services.signedInRegistries')}</strong><Show when={(source.protected_registries?.length ?? 0) > 0} fallback={<p>{i18n.t('containers.services.noSignedInRegistries')}</p>}><div><For each={source.protected_registries}>{(registry) => <Tag tone="soft" size="sm">{registry}</Tag>}</For></div></Show><p>{i18n.t('containers.services.registryCredentialsProtected')}</p></div>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'advanced'}><div class="container-service-cli-section"><div class="container-service-config-note"><Lock class="h-4 w-4" />{i18n.t('containers.services.advancedProtected')}</div><div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: 'json', wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={(content) => updateServiceConfigurationDraft({ content })} saveError={serviceConfigurationError()} /></div></div></Show>
                    </>}</Show>
                  </Show>
                </Show>
              </>}</Show>
            </Show>
          </Show>
        </Show>
      </Dialog>

      <Dialog
        open={composeEditorOpen() && !composeConfigPickerOpen() && !composeEnvPickerOpen()}
        onOpenChange={(open) => { if (!open && !composeEditorBusy() && !composeConfigPickerOpen() && !composeEnvPickerOpen()) { setComposeEditorOpen(false); resetComposeEditor(); } }}
        title={i18n.t(composeEditingID() ? 'containers.compose.editorEditTitle' : 'containers.compose.editorAddTitle')}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => { setComposeEditorOpen(false); resetComposeEditor(); }} disabled={composeEditorBusy()}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={() => void submitComposeEditor()} disabled={composeEditorBusy() || !validComposeProjectName(composeName()) || composeConfigPaths().length === 0 || (compact(composeEnvFilePath()) !== '' && !absolutePath(composeEnvFilePath()))}>{i18n.t('containers.compose.save')}</Button></div>}
      >
        <div class="container-compose-editor">
          <label>{i18n.t('containers.compose.name')}<Input value={composeName()} onInput={(event) => { setComposeNameTouched(true); setComposeName(event.currentTarget.value); }} disabled={composeEditorBusy()} autocomplete="off" placeholder={i18n.t('containers.compose.namePlaceholder')} aria-invalid={composeNameError() ? 'true' : undefined} /><small>{composeNameError()}</small></label>
          <div class="container-compose-field">
            <span class="container-compose-field__label">{i18n.t('containers.compose.configPaths')}</span>
            <div class="container-compose-path-entry"><Input value={composeConfigPathInput()} onInput={(event) => { setComposeConfigPathInput(event.currentTarget.value); setComposeConfigPathError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addComposeConfigPathInput(); } }} disabled={composeEditorBusy()} placeholder={i18n.t('containers.compose.configPathPlaceholder')} aria-invalid={composeConfigPathError() ? 'true' : undefined} /><Button size="sm" variant="outline" onClick={addComposeConfigPathInput} disabled={composeEditorBusy() || !compact(composeConfigPathInput())}>{i18n.t('containers.compose.addPath')}</Button><Button size="sm" variant="outline" onClick={() => openComposeFilePicker('config')} disabled={composeEditorBusy()}><Folder class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.compose.chooseFiles')}</Button></div>
            <small>{composeConfigPathError() || i18n.t('containers.compose.configPathsHint')}</small>
            <ol class="container-compose-path-list">
              <For each={composeConfigPaths()}>{(path, index) => <li><span class="container-compose-path-list__order">{index() + 1}</span><code title={path}>{path}</code><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.compose.moveUp')} disabled={index() === 0} onClick={() => moveComposeConfigPath(index(), -1)}><ArrowUp class="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.compose.moveDown')} disabled={index() === composeConfigPaths().length - 1} onClick={() => moveComposeConfigPath(index(), 1)}><ArrowDown class="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" class="container-icon-action container-destructive-action" aria-label={i18n.t('containers.compose.removePath')} onClick={() => setComposeConfigPaths((current) => current.filter((_, currentIndex) => currentIndex !== index()))}><X class="h-3.5 w-3.5" /></Button></li>}</For>
            </ol>
          </div>
          <div class="container-compose-field">
            <span class="container-compose-field__label">{i18n.t('containers.compose.envFile')}</span>
            <div class="container-compose-path-entry"><Input value={composeEnvFilePath()} onInput={(event) => setComposeEnvFilePath(event.currentTarget.value)} disabled={composeEditorBusy()} placeholder={i18n.t('containers.compose.envFilePlaceholder')} aria-invalid={compact(composeEnvFilePath()) !== '' && !absolutePath(composeEnvFilePath()) ? 'true' : undefined} /><Button size="sm" variant="outline" onClick={() => openComposeFilePicker('env')} disabled={composeEditorBusy()}><Folder class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.compose.chooseFile')}</Button><Show when={composeEnvFilePath()}><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.compose.clearEnvFile')} onClick={() => setComposeEnvFilePath('')}><X class="h-3.5 w-3.5" /></Button></Show></div>
            <small>{compact(composeEnvFilePath()) !== '' && !absolutePath(composeEnvFilePath()) ? i18n.t('containers.compose.errors.absolutePath') : i18n.t('containers.compose.envFileHint')}</small>
          </div>
          <div class="container-compose-field">
            <span class="container-compose-field__label">{i18n.t('containers.compose.profiles')}</span>
            <div class="container-compose-profile-input"><Input value={composeProfileInput()} onInput={(event) => updateComposeProfileInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addComposeProfile(composeProfileInput()); } }} disabled={composeEditorBusy()} placeholder={i18n.t('containers.compose.profilesPlaceholder')} aria-invalid={composeProfileError() ? 'true' : undefined} /></div>
            <div class="container-compose-profile-list"><For each={composeProfiles()}>{(profile) => <Tag tone="soft" size="sm">{profile}<button type="button" aria-label={i18n.t('containers.compose.removeProfile', { name: profile })} onClick={() => setComposeProfiles((current) => current.filter((item) => item !== profile))}><X class="h-3 w-3" /></button></Tag>}</For></div>
            <small>{composeProfileError() || i18n.t('containers.compose.profilesHint')}</small>
          </div>
        </div>
      </Dialog>

      <FileOpenPicker open={composeConfigPickerOpen()} onOpenChange={setComposeConfigPickerOpen} files={composeFilePicker.files()} homePath="/" selectionMode="multiple" maxSelections={8} initialSelectedPaths={composeConfigPaths()} fileFilter={(item) => /\.ya?ml$/iu.test(item.name)} title={i18n.t('containers.compose.chooseFiles')} confirmText={i18n.t('common.actions.confirm')} cancelText={i18n.t('common.actions.cancel')} emptyText={i18n.t('containers.compose.noComposeFiles')} onExpand={composeFilePicker.expandPath} ensurePath={composeFilePicker.ensurePath} onSelect={acceptComposeConfigSelection} />
      <FileOpenPicker open={composeEnvPickerOpen()} onOpenChange={setComposeEnvPickerOpen} files={composeFilePicker.files()} homePath="/" selectionMode="single" initialSelectedPaths={composeEnvFilePath() ? [composeEnvFilePath()] : []} title={i18n.t('containers.compose.chooseEnvFile')} confirmText={i18n.t('common.actions.confirm')} cancelText={i18n.t('common.actions.cancel')} emptyText={i18n.t('containers.compose.noEnvFiles')} onExpand={composeFilePicker.expandPath} ensurePath={composeFilePicker.ensurePath} onSelect={(paths) => setComposeEnvFilePath(paths[0] ?? '')} />

      <Dialog
        open={composeForget() !== null}
        onOpenChange={(open) => { if (!open && !composeEditorBusy()) setComposeForget(null); }}
        title={i18n.t('containers.compose.forgetTitle')}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setComposeForget(null)} disabled={composeEditorBusy()}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" variant="destructive" onClick={() => void forgetComposeProject()} disabled={composeEditorBusy()}>{i18n.t('containers.compose.forget')}</Button></div>}
      >
        <p class="text-sm leading-6 text-muted-foreground">{i18n.t('containers.compose.forgetMessage', { name: composeForget() ? resourceName('compose-projects', composeForget()!.item) : '' })}</p>
      </Dialog>

      <Dialog open={pruneOpen()} onOpenChange={setPruneOpen} title={i18n.t('containers.actions.prune')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setPruneOpen(false)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={() => runPrune(pruneTargetKey())}>{i18n.t('containers.actions.review')}</Button></div>}>
        <label class="block text-sm font-medium">{i18n.t('containers.fields.runtime')}
          <Select class="mt-1.5 w-full" value={pruneTargetKey()} onChange={setPruneTargetKey} options={pruneCandidates().map((candidate) => ({ value: runtimeKey(candidate), label: runtimeName(candidate.engine) }))} />
        </label>
      </Dialog>

      <Dialog
        open={containerRunOpen()}
        onOpenChange={(open) => { if (!open && !mutationBusy()) closeContainerRun(); }}
        class="container-run-dialog"
        title={i18n.t('containers.run.title')}
        description={i18n.t('containers.run.description')}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={closeContainerRun} disabled={mutationBusy()}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={submitContainerRun} disabled={mutationBusy() || !containerRunValid()}>{i18n.t('containers.actions.review')}</Button></div>}
      >
        <div class="container-run-form">
          <Show when={containerRunTargets().length > 1}><label class="container-run-field"><span>{i18n.t('containers.fields.runtime')}</span><Select value={containerRunDraft().targetKey} onChange={(value) => updateContainerRunDraft({ targetKey: value })} options={containerRunTargets().map((runtime) => ({ value: runtimeKey(runtime), label: runtimeName(runtime.engine) }))} /></label></Show>

          <section class="container-run-section">
            <header><div><strong>{i18n.t('containers.run.basics')}</strong><span>{i18n.t('containers.run.basicsHint')}</span></div></header>
            <div class="container-run-grid">
              <label class="container-run-field container-run-field--wide"><span>{i18n.t('containers.fields.image')} *</span><Input value={containerRunDraft().image} onInput={(event) => updateContainerRunDraft({ image: event.currentTarget.value })} placeholder="docker.io/library/nginx:latest" aria-invalid={containerRunErrors().image ? 'true' : undefined} /><small>{containerRunErrors().image}</small></label>
              <label class="container-run-field"><span>{i18n.t('containers.fields.name')}</span><Input value={containerRunDraft().name} onInput={(event) => updateContainerRunDraft({ name: event.currentTarget.value })} placeholder="e.g. my-app" aria-invalid={containerRunErrors().name ? 'true' : undefined} /><small>{containerRunErrors().name || i18n.t('containers.run.optional')}</small></label>
              <label class="container-run-field"><span>{i18n.t('containers.run.entrypoint')}</span><Input value={containerRunDraft().entrypoint} onInput={(event) => updateContainerRunDraft({ entrypoint: event.currentTarget.value })} placeholder="/docker-entrypoint.sh" aria-invalid={containerRunErrors().entrypoint ? 'true' : undefined} /><small>{containerRunErrors().entrypoint || i18n.t('containers.run.entrypointHint')}</small></label>
            </div>
            <div class="container-run-list-field">
              <div class="container-run-list-heading"><div><strong>{i18n.t('containers.run.arguments')}</strong><span>{i18n.t('containers.run.argumentsHint')}</span></div><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ arguments: [...containerRunDraft().arguments, { id: containerRunRowID('arg'), value: '' }] })}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.run.addArgument')}</Button></div>
              <For each={containerRunDraft().arguments}>{(argument, index) => <div class="container-run-inline-row"><span class="container-run-order">{index() + 1}</span><Input value={argument.value} onInput={(event) => updateContainerRunArgument(argument.id, event.currentTarget.value)} placeholder="--config" aria-invalid={containerRunErrors()[`argument:${argument.id}`] ? 'true' : undefined} /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ arguments: containerRunDraft().arguments.filter((item) => item.id !== argument.id) })}><X class="h-3.5 w-3.5" /></Button><small>{containerRunErrors()[`argument:${argument.id}`]}</small></div>}</For>
            </div>
          </section>

          <section class="container-run-section">
            <header><div><strong>{i18n.t('containers.run.ports')}</strong><span>{i18n.t('containers.run.portsHint')}</span></div><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ ports: [...containerRunDraft().ports, emptyContainerRunPort()] })}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.run.addPort')}</Button></header>
            <Show when={containerRunPortSuggestions().length > 0}>
              <div class="container-run-port-suggestions" aria-label={i18n.t('containers.run.ports')}>
                <For each={containerRunPortSuggestions()}>{(port) => <Button size="sm" variant="ghost" onClick={() => {
                  updateContainerRunDraft({ ports: [...containerRunDraft().ports, { ...port, id: containerRunRowID('port') }] });
                  setContainerRunPortSuggestions((current) => current.filter((candidate) => candidate.containerPort !== port.containerPort || candidate.protocol !== port.protocol));
                }}><Plus class="h-3.5 w-3.5" />{port.containerPort}/{port.protocol}</Button>}</For>
              </div>
            </Show>
            <Show when={containerRunDraft().ports.length > 0} fallback={<div class="container-run-empty">{i18n.t('containers.run.noPorts')}</div>}>
              <For each={containerRunDraft().ports}>{(port) => <div class="container-run-port-row">
                <label><span>{i18n.t('containers.run.containerPort')}</span><Input inputmode="numeric" value={port.containerPort} onInput={(event) => updateContainerRunPort(port.id, { containerPort: event.currentTarget.value })} placeholder="8080" /></label>
                <label><span>{i18n.t('containers.run.hostPort')}</span><Input inputmode="numeric" value={port.hostPort} onInput={(event) => updateContainerRunPort(port.id, { hostPort: event.currentTarget.value })} placeholder={i18n.t('containers.run.autoPort')} /></label>
                <label><span>{i18n.t('containers.run.listenAddress')}</span><Input value={port.hostIP} onInput={(event) => updateContainerRunPort(port.id, { hostIP: event.currentTarget.value })} placeholder="127.0.0.1" /></label>
                <label><span>{i18n.t('containers.run.protocol')}</span><select value={port.protocol} onChange={(event) => updateContainerRunPort(port.id, { protocol: event.currentTarget.value as ContainerRunPort['protocol'] })}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="sctp">SCTP</option></select></label>
                <Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ ports: containerRunDraft().ports.filter((item) => item.id !== port.id) })}><X class="h-3.5 w-3.5" /></Button>
                <small>{containerRunErrors()[`port:${port.id}`]}</small>
              </div>}</For>
            </Show>
          </section>

          <section class="container-run-section">
            <header><div><strong>{i18n.t('containers.run.storage')}</strong><span>{i18n.t('containers.run.storageHint')}</span></div><div class="container-run-add-group"><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ mounts: [...containerRunDraft().mounts, emptyContainerRunMount('bind')] })}>{i18n.t('containers.run.addBind')}</Button><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ mounts: [...containerRunDraft().mounts, emptyContainerRunMount('volume')] })}>{i18n.t('containers.run.addVolume')}</Button><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ mounts: [...containerRunDraft().mounts, emptyContainerRunMount('tmpfs')] })}>{i18n.t('containers.run.addTmpfs')}</Button></div></header>
            <datalist id="container-run-volume-names"><For each={containerVolumeNames()}>{(name) => <option value={name} />}</For></datalist>
            <Show when={containerRunDraft().mounts.length > 0} fallback={<div class="container-run-empty">{i18n.t('containers.run.noStorage')}</div>}>
              <For each={containerRunDraft().mounts}>{(mount) => <div class="container-run-mount-row" data-type={mount.type}>
                <div class="container-run-row-title"><Tag tone="soft" size="sm">{i18n.t(`containers.run.mountTypes.${mount.type}` as Parameters<typeof i18n.t>[0])}</Tag><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ mounts: containerRunDraft().mounts.filter((item) => item.id !== mount.id) })}><X class="h-3.5 w-3.5" /></Button></div>
                <Show when={mount.type !== 'tmpfs'}><label class="container-run-field"><span>{mount.type === 'volume' ? i18n.t('containers.run.volumeName') : i18n.t('containers.run.hostPath')}</span><div class="container-run-path-input"><Input value={mount.source} list={mount.type === 'volume' ? 'container-run-volume-names' : undefined} onInput={(event) => updateContainerRunMount(mount.id, { source: event.currentTarget.value })} placeholder={mount.type === 'volume' ? 'app-data' : '/Users/me/data'} /><Show when={mount.type === 'bind'}><Button size="sm" variant="outline" onClick={() => openContainerPathPicker({ kind: 'file', owner: 'mount', id: mount.id })}>{i18n.t('containers.run.chooseFile')}</Button><Button size="sm" variant="outline" onClick={() => openContainerPathPicker({ kind: 'directory', owner: 'mount', id: mount.id })}>{i18n.t('containers.run.chooseFolder')}</Button></Show></div><Show when={mount.type === 'volume' && containerVolumeNamesLoading()}><small>{i18n.t('containers.loading')}</small></Show></label></Show>
                <label class="container-run-field"><span>{i18n.t('containers.run.containerPath')}</span><Input value={mount.target} onInput={(event) => updateContainerRunMount(mount.id, { target: event.currentTarget.value })} placeholder="/data" /></label>
                <Show when={mount.type === 'tmpfs'}><label class="container-run-field"><span>{i18n.t('containers.run.tmpfsSize')}</span><Input inputmode="decimal" value={mount.tmpfsSizeMiB} onInput={(event) => updateContainerRunMount(mount.id, { tmpfsSizeMiB: event.currentTarget.value })} placeholder="64" /></label><div class="container-run-checks"><label><input type="checkbox" checked={mount.noexec} onChange={(event) => updateContainerRunMount(mount.id, { noexec: event.currentTarget.checked })} />noexec</label><label><input type="checkbox" checked={mount.nosuid} onChange={(event) => updateContainerRunMount(mount.id, { nosuid: event.currentTarget.checked })} />nosuid</label><label><input type="checkbox" checked={mount.nodev} onChange={(event) => updateContainerRunMount(mount.id, { nodev: event.currentTarget.checked })} />nodev</label></div></Show>
                <Show when={mount.type !== 'tmpfs'}><label class="container-run-check"><input type="checkbox" checked={mount.readOnly} onChange={(event) => updateContainerRunMount(mount.id, { readOnly: event.currentTarget.checked })} />{i18n.t('containers.detail.readOnly')}</label></Show>
                <small>{containerRunErrors()[`mount:${mount.id}`]}</small>
              </div>}</For>
            </Show>
          </section>

          <section class="container-run-section">
            <header><div><strong>{i18n.t('containers.run.environment')}</strong><span>{i18n.t('containers.run.environmentHint')}</span></div><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ environment: [...containerRunDraft().environment, { id: containerRunRowID('env'), key: '', value: '', revealed: false }] })}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.run.addVariable')}</Button></header>
            <For each={containerRunDraft().environment}>{(entry) => <div class="container-run-key-value"><Input value={entry.key} onInput={(event) => updateContainerRunEnvironment(entry.id, { key: event.currentTarget.value })} placeholder="APP_ENV" /><div class="container-run-secret"><Input type={entry.revealed ? 'text' : 'password'} value={entry.value} onInput={(event) => updateContainerRunEnvironment(entry.id, { value: event.currentTarget.value })} placeholder="production" autocomplete="new-password" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={entry.revealed ? i18n.t('containers.run.hideValue') : i18n.t('containers.run.showValue')} onClick={() => updateContainerRunEnvironment(entry.id, { revealed: !entry.revealed })}>{entry.revealed ? <EyeOff class="h-3.5 w-3.5" /> : <Eye class="h-3.5 w-3.5" />}</Button></div><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ environment: containerRunDraft().environment.filter((item) => item.id !== entry.id) })}><X class="h-3.5 w-3.5" /></Button><small>{containerRunErrors()[`environment:${entry.id}`]}</small></div>}</For>
          </section>

          <section class="container-run-section">
            <header><div><strong>{i18n.t('containers.run.resourcesAndRuntime')}</strong><span>{i18n.t('containers.run.resourcesHint')}</span></div></header>
            <div class="container-run-grid">
              <label class="container-run-field"><span>{i18n.t('containers.fields.cpus')}</span><Input inputmode="decimal" value={containerRunDraft().cpuCount} onInput={(event) => updateContainerRunDraft({ cpuCount: event.currentTarget.value })} placeholder={i18n.t('containers.run.unlimited')} aria-invalid={containerRunErrors().cpuCount ? 'true' : undefined} /><small>{containerRunErrors().cpuCount}</small></label>
              <label class="container-run-field"><span>{i18n.t('containers.run.memory')}</span><div class="container-run-unit"><Input inputmode="decimal" value={containerRunDraft().memory} onInput={(event) => updateContainerRunDraft({ memory: event.currentTarget.value })} placeholder={i18n.t('containers.run.unlimited')} /><select value={containerRunDraft().memoryUnit} onChange={(event) => updateContainerRunDraft({ memoryUnit: event.currentTarget.value as 'MiB' | 'GiB' })}><option>MiB</option><option>GiB</option></select></div><small>{containerRunErrors().memory}</small></label>
              <label class="container-run-field"><span>{i18n.t('containers.run.network')}</span><Input value={containerRunDraft().networkMode} onInput={(event) => updateContainerRunDraft({ networkMode: event.currentTarget.value })} placeholder="bridge" /></label>
              <label class="container-run-field"><span>{i18n.t('containers.fields.restartPolicy')}</span><select value={containerRunDraft().restartPolicy} onChange={(event) => updateContainerRunDraft({ restartPolicy: event.currentTarget.value })}><option value="no">no</option><option value="always">always</option><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option></select></label>
            </div>
          </section>

          <Button size="sm" variant="ghost" class="container-run-advanced-toggle" aria-expanded={containerRunAdvanced()} onClick={() => setContainerRunAdvanced((open) => !open)}><ChevronRight class={`h-4 w-4 ${containerRunAdvanced() ? 'rotate-90' : ''}`} />{i18n.t('containers.run.advanced')}</Button>
          <Show when={containerRunAdvanced()}>
            <section class="container-run-section container-run-section--advanced">
              <div class="container-run-grid">
                <label class="container-run-field"><span>{i18n.t('containers.run.user')}</span><Input value={containerRunDraft().user} onInput={(event) => updateContainerRunDraft({ user: event.currentTarget.value })} placeholder="1000:1000" /></label>
                <label class="container-run-field"><span>{i18n.t('containers.run.pidMode')}</span><Input value={containerRunDraft().pidMode} onInput={(event) => updateContainerRunDraft({ pidMode: event.currentTarget.value })} placeholder="host" /></label>
                <label class="container-run-field"><span>{i18n.t('containers.run.ipcMode')}</span><Input value={containerRunDraft().ipcMode} onInput={(event) => updateContainerRunDraft({ ipcMode: event.currentTarget.value })} placeholder="private" /></label>
                <label class="container-run-field"><span>{i18n.t('containers.run.pidsLimit')}</span><Input inputmode="numeric" value={containerRunDraft().pidsLimit} onInput={(event) => updateContainerRunDraft({ pidsLimit: event.currentTarget.value })} placeholder={i18n.t('containers.run.unlimited')} /><small>{containerRunErrors().pidsLimit}</small></label>
                <label class="container-run-field"><span>{i18n.t('containers.run.sharedMemory')}</span><div class="container-run-unit"><Input inputmode="decimal" value={containerRunDraft().shmSize} onInput={(event) => updateContainerRunDraft({ shmSize: event.currentTarget.value })} placeholder="64" /><select value={containerRunDraft().shmUnit} onChange={(event) => updateContainerRunDraft({ shmUnit: event.currentTarget.value as 'MiB' | 'GiB' })}><option>MiB</option><option>GiB</option></select></div><small>{containerRunErrors().shmSize}</small></label>
              </div>
              <div class="container-run-checks container-run-checks--prominent"><label><input type="checkbox" checked={containerRunDraft().readOnlyRoot} onChange={(event) => updateContainerRunDraft({ readOnlyRoot: event.currentTarget.checked })} />{i18n.t('containers.inspector.readOnlyRoot')}</label><label class="container-run-danger-check"><input type="checkbox" checked={containerRunDraft().privileged} onChange={(event) => updateContainerRunDraft({ privileged: event.currentTarget.checked })} />{i18n.t('containers.inspector.privileged')}</label></div>

              <div class="container-run-list-field"><div class="container-run-list-heading"><strong>{i18n.t('containers.run.labels')}</strong><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ labels: [...containerRunDraft().labels, { id: containerRunRowID('label'), key: '', value: '' }] })}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.run.addLabel')}</Button></div><For each={containerRunDraft().labels}>{(entry) => <div class="container-run-key-value"><Input value={entry.key} onInput={(event) => updateContainerRunLabel(entry.id, { key: event.currentTarget.value })} placeholder="com.example.role" /><Input value={entry.value} onInput={(event) => updateContainerRunLabel(entry.id, { value: event.currentTarget.value })} placeholder="worker" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ labels: containerRunDraft().labels.filter((item) => item.id !== entry.id) })}><X class="h-3.5 w-3.5" /></Button><small>{containerRunErrors()[`label:${entry.id}`]}</small></div>}</For></div>

              <div class="container-run-advanced-lists">
                <div class="container-run-list-field"><div class="container-run-list-heading"><strong>{i18n.t('containers.run.capAdd')}</strong><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ capAdd: [...containerRunDraft().capAdd, { id: containerRunRowID('cap-add'), value: '' }] })}><Plus class="h-3.5 w-3.5" /></Button></div><For each={containerRunDraft().capAdd}>{(entry) => <div class="container-run-inline-row"><Input value={entry.value} onInput={(event) => updateContainerRunDraft({ capAdd: containerRunDraft().capAdd.map((item) => item.id === entry.id ? { ...item, value: event.currentTarget.value } : item) })} placeholder="NET_ADMIN" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ capAdd: containerRunDraft().capAdd.filter((item) => item.id !== entry.id) })}><X class="h-3.5 w-3.5" /></Button></div>}</For></div>
                <div class="container-run-list-field"><div class="container-run-list-heading"><strong>{i18n.t('containers.run.capDrop')}</strong><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ capDrop: [...containerRunDraft().capDrop, { id: containerRunRowID('cap-drop'), value: '' }] })}><Plus class="h-3.5 w-3.5" /></Button></div><For each={containerRunDraft().capDrop}>{(entry) => <div class="container-run-inline-row"><Input value={entry.value} onInput={(event) => updateContainerRunDraft({ capDrop: containerRunDraft().capDrop.map((item) => item.id === entry.id ? { ...item, value: event.currentTarget.value } : item) })} placeholder="ALL" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ capDrop: containerRunDraft().capDrop.filter((item) => item.id !== entry.id) })}><X class="h-3.5 w-3.5" /></Button></div>}</For></div>
                <div class="container-run-list-field"><div class="container-run-list-heading"><strong>{i18n.t('containers.run.securityOptions')}</strong><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ securityOptions: [...containerRunDraft().securityOptions, { id: containerRunRowID('security'), value: '' }] })}><Plus class="h-3.5 w-3.5" /></Button></div><For each={containerRunDraft().securityOptions}>{(entry) => <div class="container-run-inline-row"><Input value={entry.value} onInput={(event) => updateContainerRunDraft({ securityOptions: containerRunDraft().securityOptions.map((item) => item.id === entry.id ? { ...item, value: event.currentTarget.value } : item) })} placeholder="no-new-privileges" /><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ securityOptions: containerRunDraft().securityOptions.filter((item) => item.id !== entry.id) })}><X class="h-3.5 w-3.5" /></Button></div>}</For></div>
              </div>

              <div class="container-run-list-field"><div class="container-run-list-heading"><div><strong>{i18n.t('containers.run.devices')}</strong><span>{i18n.t('containers.run.devicesHint')}</span></div><Button size="sm" variant="ghost" onClick={() => updateContainerRunDraft({ devices: [...containerRunDraft().devices, { id: containerRunRowID('device'), hostPath: '', containerPath: '', permissions: 'rwm' }] })}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.run.addDevice')}</Button></div><For each={containerRunDraft().devices}>{(device) => <div class="container-run-device-row"><label><span>{i18n.t('containers.run.hostPath')}</span><div class="container-run-path-input"><Input value={device.hostPath} onInput={(event) => updateContainerRunDevice(device.id, { hostPath: event.currentTarget.value })} placeholder="/dev/ttyUSB0" /><Button size="sm" variant="outline" onClick={() => openContainerPathPicker({ kind: 'file', owner: 'device', id: device.id })}>{i18n.t('containers.run.chooseFile')}</Button></div></label><label><span>{i18n.t('containers.run.containerPath')}</span><Input value={device.containerPath} onInput={(event) => updateContainerRunDevice(device.id, { containerPath: event.currentTarget.value })} placeholder="/dev/ttyUSB0" /></label><label><span>{i18n.t('containers.run.permissions')}</span><Input value={device.permissions} onInput={(event) => updateContainerRunDevice(device.id, { permissions: event.currentTarget.value })} placeholder="rwm" /></label><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t('containers.run.removeRow')} onClick={() => updateContainerRunDraft({ devices: containerRunDraft().devices.filter((item) => item.id !== device.id) })}><X class="h-3.5 w-3.5" /></Button><small>{containerRunErrors()[`device:${device.id}`]}</small></div>}</For></div>
            </section>
          </Show>
        </div>
      </Dialog>

      <FileOpenPicker open={containerPathPicker()?.kind === 'file'} onOpenChange={(open) => { if (!open) setContainerPathPicker(null); }} files={containerPathDataSource.files()} homePath="/" selectionMode="single" initialSelectedPaths={[]} title={i18n.t('containers.run.chooseHostFile')} confirmText={i18n.t('common.actions.confirm')} cancelText={i18n.t('common.actions.cancel')} emptyText={i18n.t('containers.run.noFiles')} onExpand={containerPathDataSource.expandPath} ensurePath={containerPathDataSource.ensurePath} onSelect={(paths) => acceptContainerPath(paths[0] ?? '')} />
      <DirectoryPicker open={containerPathPicker()?.kind === 'directory'} onOpenChange={(open) => { if (!open) setContainerPathPicker(null); }} files={containerPathDataSource.files()} homePath="/" initialPath="/" title={i18n.t('containers.run.chooseHostFolder')} confirmText={i18n.t('common.actions.confirm')} cancelText={i18n.t('common.actions.cancel')} onExpand={containerPathDataSource.expandPath} ensurePath={containerPathDataSource.ensurePath} onSelect={acceptContainerPath} />

      <Dialog open={creationMode() !== null} onOpenChange={(open) => !open && setCreationMode(null)} title={creationMode() === 'image-tag' ? i18n.t('containers.create.tagTitle') : i18n.t('containers.create.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setCreationMode(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={submitCreation} disabled={mutationBusy() || creationTargets().length === 0 || !compact(creationName() || creationImage())}>{i18n.t('containers.actions.review')}</Button></div>}>
        <div class="space-y-4">
          <Show when={creationTargets().length > 1}><label class="block text-sm font-medium">{i18n.t('containers.fields.runtime')}<Select class="mt-1.5 w-full" value={creationTargetKey()} onChange={setCreationTargetKey} options={creationTargets().map((runtime) => ({ value: runtimeKey(runtime), label: runtimeName(runtime.engine) }))} /></label></Show>
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

      <Dialog
        open={review() !== null}
        onOpenChange={(open) => { if (!open) cancelReview(); }}
        title={reviewedPrune() ? i18n.t('containers.prune.reviewTitle') : i18n.t('containers.review.title')}
        class={reviewedPrune() ? 'container-prune-review-dialog' : undefined}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={cancelReview}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" variant={reviewedPrune() ? 'destructive' : 'default'} onClick={() => void runReviewedOperation()} disabled={mutationBusy() || (review()?.preflight.plan.requires_admin && !canAdmin()) || Boolean(reviewedPrune() && !reviewedPrune()?.complete)}><Show when={reviewedPrune()}><Trash class="mr-1.5 h-3.5 w-3.5" /></Show>{reviewedPrune() ? i18n.t('containers.prune.confirm') : i18n.t('containers.actions.run')}</Button></div>}
      >
        <Show when={review()} keyed>{(current) => <Show when={reviewedPrune()} fallback={<div class="space-y-3"><div class="flex items-center justify-between rounded-lg border p-3"><div><div class="text-xs text-muted-foreground">{i18n.t('containers.review.operation')}</div><div class="mt-1 font-mono text-sm">{operationLabel(current.preflight.method)}</div></div><Tag variant={current.preflight.plan.risk_level === 'high' || current.preflight.plan.risk_level === 'critical' ? 'warning' : 'neutral'} tone="soft" size="sm">{current.preflight.plan.risk_level}</Tag></div><Show when={current.preflight.resource_kind === 'container_service'}><div class="container-service-impact"><div><span>{i18n.t('containers.services.runningContainers')}</span><strong>{Number(current.preflight.plan.target.running_container_count ?? 0)}</strong></div><div><span>{i18n.t('containers.services.affectedServices')}</span><strong>{Number(current.preflight.plan.target.affected_web_service_count ?? 0)}</strong></div><Show when={Array.isArray(current.preflight.plan.target.affected_web_service_names) && (current.preflight.plan.target.affected_web_service_names as string[]).length > 0}><p>{(current.preflight.plan.target.affected_web_service_names as string[]).join(', ')}</p></Show></div></Show><For each={current.preflight.plan.summary ?? []}>{(summary) => <p class="text-sm text-muted-foreground">{summary}</p>}</For><For each={current.preflight.plan.risk_flags ?? []}>{(flag) => <div class="rounded-lg border border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] p-3"><div class="text-sm font-medium text-[var(--redeven-status-warning-foreground)]">{flag.title}</div><p class="mt-1 text-xs leading-5 text-muted-foreground">{flag.detail}</p></div>}</For><Show when={current.preflight.plan.requires_admin && !canAdmin()}><p class="text-sm text-destructive">{i18n.t('containers.permissions.admin')}</p></Show><div class="grid gap-1 rounded-lg bg-muted/40 p-3 font-mono text-[10px] text-muted-foreground"><span>{current.preflight.request_hash}</span><span>{current.preflight.plan_hash}</span></div></div>}>{(model) => <PruneReviewPanel model={model()} />}</Show>}</Show>
      </Dialog>
    </div>
  );
}

function PruneReviewPanel(props: { model: PruneReviewModel }) {
  const i18n = useI18n();
  return (
    <div class="container-prune-review">
      <section class="container-prune-review__summary">
        <span class="container-prune-review__mark"><Trash class="h-4 w-4" /></span>
        <div class="container-prune-review__intro">
          <strong>{i18n.t('containers.prune.permanentTitle')}</strong>
          <span>{i18n.t('containers.prune.permanentMessage')}</span>
        </div>
        <div class="container-prune-review__metrics">
          <div><span>{i18n.t('containers.prune.resources')}</span><strong>{props.model.resourceCount}</strong></div>
          <div><span>{i18n.t('containers.prune.reclaimable')}</span><strong>{formatBytes(props.model.reclaimableBytes)}</strong></div>
        </div>
      </section>

      <Show when={props.model.complete} fallback={<div class="container-prune-review__incomplete" role="alert"><AlertTriangle class="h-4 w-4" /><span>{i18n.t('containers.prune.listUnavailable')}</span></div>}>
        <section class="container-prune-review__resources" aria-label={i18n.t('containers.prune.resourceList')}>
          <div class="container-prune-review__heading">{i18n.t('containers.prune.resourceList')}</div>
          <div class="container-prune-review__list" role="list" data-prune-review-list>
            <For each={props.model.resources}>{(resource) => {
              const name = resource.name || (props.model.kind === 'images' ? i18n.t('containers.prune.untaggedImage') : resource.identity);
              const references = resource.references.filter((reference) => reference !== name);
              return <div class="container-prune-review__row" role="listitem" data-prune-resource-id={resource.identity}>
                <span class="container-prune-review__icon">{props.model.kind === 'images' ? <Package class="h-4 w-4" /> : <Database class="h-4 w-4" />}</span>
                <div class="container-prune-review__identity">
                  <strong title={name}>{name}</strong>
                  <Show when={references.length > 0}><span title={references.join(', ')}>{references.join(' · ')}</span></Show>
                </div>
                <div class="container-prune-review__meta">
                  <Show when={props.model.kind === 'images'} fallback={<span>{resource.driver || '—'}</span>}><code title={resource.identity}>{shortPruneIdentity(resource.identity)}</code><strong>{formatBytes(resource.sizeBytes)}</strong></Show>
                </div>
              </div>;
            }}</For>
          </div>
        </section>
      </Show>
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
