export type Observation = {
  state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  observedAt: string;
  evidenceRefs: string[];
};
export type CanvasNode = {
  id: string;
  name: string;
  runtimeRef: string;
  observation?: Observation;
};
export type Group = { id: string; name: string; nodeRefs: string[]; instanceRefs?: string[] };
export type BusinessService = {
  id: string;
  name: string;
  kind: string;
  description?: string;
};
export type Binding = {
  owner: 'managed_service' | 'container';
  resourceId: string;
  engine?: 'docker' | 'podman';
  endpointId?: string;
  identity?: string;
};
export type Instance = {
  id: string;
  nodeRef: string;
  serviceRef: string;
  role: string;
  name?: string;
  shard?: string;
  binding?: Binding;
  observation?: Observation;
};
export type Resource = {
  id: string;
  name: string;
  kind: string;
  endpoint?: string;
  description?: string;
  observation?: Observation;
};
export type Relation = {
  id: string;
  from: string;
  to: string;
  kind: string;
  protocol?: string;
  evidenceRefs: string[];
};
export type Evidence = {
  id: string;
  source: string;
  locator: string;
  summary: string;
  observedAt?: string;
};
export type LayoutDirection = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
export type RenderModel = {
  metadata: { title: string; description?: string };
  nodes?: CanvasNode[];
  groups?: Group[];
  services?: BusinessService[];
  instances?: Instance[];
  resources?: Resource[];
  relations?: Relation[];
  evidence?: Evidence[];
  objects?: GenericObject[];
  presentation?: {
    groupLayouts?: Record<string, { flow: 'row' | 'column'; maxPerLine?: number }>;
    initiallyExpanded?: string[];
    order?: string[];
    direction?: LayoutDirection;
    layers?: string[][];
    positions?: { objectRef: string; x: number; y: number }[];
  };
};
export type GenericObject = {
  id: string;
  name: string;
  kind: string;
  description?: string;
  facts?: { label: string; value: string }[];
  objectRefs?: string[];
};
// The editing document remains independent of the display protocol. Shared
// field shapes describe current semantics, without granting future DSL support.
export type CanvasDocument = {
  apiVersion: string;
  kind: 'ServiceCanvas';
  metadata: { title: string; description?: string };
  nodes?: CanvasNode[];
  groups?: Group[];
  services?: BusinessService[];
  instances?: Instance[];
  resources?: Resource[];
  relations?: Relation[];
  evidence?: Evidence[];
  presentation?: RenderModel['presentation'];
};
export type PresentationLimitation = { code: string; object_refs: string[]; feature?: string };
export type CanvasPresentation = {
  format: string;
  model: RenderModel;
  capabilities: string[];
  compatibility: {
    status: 'complete' | 'limited' | 'unavailable';
    limitations: PresentationLimitation[];
  };
};
export type RenderVersion = {
  canvas_id: string;
  number: number;
  source: string;
  view: CanvasPresentation;
};
export type Canvas = {
  id: string;
  title: string;
  description: string;
  latest_version: number;
  archived: boolean;
  created_at: number;
  updated_at: number;
  flower_thread_id?: string;
};
export type DSLMigration = { from: string; to: string };
export type Version = {
  dsl_version?: string;
  migrations?: DSLMigration[];
  canvas_id: string;
  number: number;
  document_yaml: string;
  document: CanvasDocument;
  digest: string;
  created_at: number;
  source: string;
  summary: string;
  diagnostics?: Diagnostic[];
};
export type VersionSummary = Omit<Version, 'document' | 'document_yaml'>;
export type SaveResult = { canvas: Canvas; version: Version };
export type Diagnostic = {
  path: string;
  line: number;
  column: number;
  message: string;
};
export type Validation = {
  dsl_version?: string;
  migrations?: DSLMigration[];
  valid: boolean;
  diagnostics: Diagnostic[];
  document?: CanvasDocument;
};
export type Selection = {
  canvas_id: string;
  version_id: number;
  object_refs: string[];
};
export type TessivenTransport = {
  request: <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<T>;
  subscribe: (
    changed: () => void,
    error: (error: unknown) => void,
  ) => () => void;
};
export const TESSIVEN_API = '/_redeven_proxy/api/tessiven';
export type TessivenText = (
  key: string,
  values?: Record<string, string | number>,
) => string;
