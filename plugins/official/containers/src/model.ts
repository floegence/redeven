import type {
  PluginOperation,
  PluginOperationProgress,
  PluginStream,
  PluginSurfaceContext,
  PluginUIVNode,
} from '@floegence/redevplugin-ui/plugin';
import type {
  ComposeProjectsListResponse,
  ContainersListResponse,
  CreateRequest,
  EndpointsListResponse,
  ImagesResponse,
  PodsListResponse,
  StatsEvent,
  VolumesResponse,
} from '../../../../spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v4/v4.0.0/redeven.container_resources.v4.client';
import type { CopyKey } from './i18n';

export type Engine = 'docker' | 'podman';
export type View = 'overview' | 'containers' | 'images' | 'volumes' | 'projects' | 'pods';
export type ResourceFilter = 'all' | 'running' | 'paused' | 'stopped' | 'in-use' | 'unused';
export type SortKey = 'name' | 'created' | 'state' | 'size' | 'usage';
export type Container = ContainersListResponse['containers'][number];
export type Image = ImagesResponse['images'][number];
export type Volume = VolumesResponse['volumes'][number];
export type Endpoint = EndpointsListResponse['endpoints'][number];
export type ComposeProject = ComposeProjectsListResponse['projects'][number];
export type Pod = PodsListResponse['pods'][number];
export type AnyOperation = PluginOperation<object>;
export type AnyStream = PluginStream<object, object>;
export type Message = { key: CopyKey; params?: Record<string, string | number | Message> } | { literal: string };
export type Plan = {
  method: string;
  plan_digest?: string;
  risk_level?: string;
  risk_flags?: Array<{ id: string; severity: string; title?: string; detail?: string }>;
  summary?: string[];
  requires_admin?: boolean;
  target?: object;
  request?: object;
};
export type DirectMethod = 'stop' | 'restart' | 'pause' | 'unpause' | 'kill';
export type Intent =
  | { kind: 'create-container'; request: CreateRequest }
  | { kind: 'start-container'; containerID: string }
  | { kind: 'remove-container'; containerID: string; force: boolean; confirmationName: string }
  | { kind: 'prune-images' }
  | { kind: 'create-volume'; name: string; driver: string; options?: Array<{ key: string; value: string }> }
  | { kind: 'remove-volume'; name: string }
  | { kind: 'prune-volumes' }
  | { kind: 'remove-image'; image: string; force: boolean; confirmationName: string }
  | { kind: 'compose-action'; method: 'compose.projects.start' | 'compose.projects.stop' | 'compose.projects.restart' | 'compose.projects.down'; projectID: string; name: string }
  | { kind: 'create-pod'; name: string }
  | { kind: 'pod-action'; method: 'pods.start' | 'pods.stop' | 'pods.restart' | 'pods.remove'; podID: string; name: string }
  | { kind: 'direct'; method: DirectMethod; target: string };
export type InspectorTab = 'overview' | 'usage' | 'logs' | 'technical';
export type ResourceInspectorKind = 'image' | 'volume';
export type ResourceInspectorTab = 'overview' | 'usage' | 'history' | 'technical';
export type FormRowKind = 'command' | 'env' | 'ports' | 'mounts' | 'devices' | 'volume-options';
export type Dialog =
  | { kind: 'none' }
  | { kind: 'create-container'; error?: Message }
  | { kind: 'pull-image'; error?: Message }
  | { kind: 'tag-image'; image: string; error?: Message }
  | { kind: 'create-volume'; error?: Message }
  | { kind: 'create-pod'; error?: Message }
  | { kind: 'remove-container'; containerID: string; containerName: string; running: boolean; error?: Message }
  | { kind: 'remove-image'; image: string; references: number; error?: Message }
  | { kind: 'plan'; title: Message; plan: Plan; summary?: Message[]; intent: Intent; engine: Engine; endpointID: string; busy: boolean; error?: Message }
  | { kind: 'details'; title: Message; body: () => PluginUIVNode; returnKey: string; containerID?: string; tab?: InspectorTab; resourceKind?: ResourceInspectorKind; resourceID?: string; resourceTab?: ResourceInspectorTab };
export type ReconcileResult = { complete: boolean; detail?: Message };
export type ResourceRefinement = { query: string; filter: ResourceFilter; sort: SortKey };
export type OperationRecord = {
  key: string;
  engine: Engine;
  endpointID: string;
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

export type ContainersAppState = {
  engine: Engine;
  endpointID: string;
  endpoints: Endpoint[];
  view: View;
  query: string;
  filters: Record<View, ResourceFilter>;
  sorts: Record<View, SortKey>;
  refinements: Map<string, ResourceRefinement>;
  available: boolean;
  version: string;
  loading: boolean;
  updating: boolean;
  loaded: boolean;
  dataEngine: Engine;
  dataEndpointID: string;
  error?: Message;
  viewErrors: Partial<Record<View, Message>>;
  partialFailures: Record<'images' | 'volumes', number>;
  inventoryFresh: Record<View, boolean>;
  statsFailures: number;
  notice?: Message;
  containers: Container[];
  images: Image[];
  volumes: Volume[];
  projects: ComposeProject[];
  pods: Pod[];
  containerStats: Map<string, StatsEvent>;
  liveLogs: Map<string, string[]>;
  formRows: Record<FormRowKind, number[]>;
  nextFormRowID: number;
  dialog: Dialog;
  operations: Map<string, OperationRecord>;
  context?: PluginSurfaceContext;
};

export function initialFormRows(): Record<FormRowKind, number[]> {
  return { command: [1], env: [1], ports: [1], mounts: [1], devices: [1], 'volume-options': [1] };
}

export function createInitialContainersState(): ContainersAppState {
  return {
    engine: 'docker',
    endpointID: '',
    endpoints: [],
    view: 'overview',
    query: '',
    filters: { overview: 'all', containers: 'all', images: 'all', volumes: 'all', projects: 'all', pods: 'all' },
    sorts: { overview: 'name', containers: 'state', images: 'name', volumes: 'name', projects: 'state', pods: 'state' },
    refinements: new Map(),
    available: false,
    version: '',
    loading: true,
    updating: false,
    loaded: false,
    dataEngine: 'docker',
    dataEndpointID: '',
    viewErrors: {},
    partialFailures: { images: 0, volumes: 0 },
    inventoryFresh: { overview: false, containers: false, images: false, volumes: false, projects: false, pods: false },
    statsFailures: 0,
    containers: [],
    images: [],
    volumes: [],
    projects: [],
    pods: [],
    containerStats: new Map(),
    liveLogs: new Map(),
    formRows: initialFormRows(),
    nextFormRowID: 2,
    dialog: { kind: 'none' },
    operations: new Map(),
  };
}

export type { CreateRequest };
