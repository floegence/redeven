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
export type CanvasDocument = {
  apiVersion: 'redeven.io/tessiven/v1';
  kind: 'ServiceCanvas';
  metadata: { title: string; description?: string };
  nodes?: CanvasNode[];
  groups?: Group[];
  services?: BusinessService[];
  instances?: Instance[];
  resources?: Resource[];
  relations?: Relation[];
  evidence?: Evidence[];
  presentation?: {
    initiallyExpanded?: string[];
    order?: string[];
    positions?: { objectRef: string; x: number; y: number }[];
  };
};
export type Canvas = {
  id: string;
  title: string;
  description: string;
  latest_version: number;
  archived: boolean;
  created_at: number;
  updated_at: number;
};
export type Version = {
  canvas_id: string;
  number: number;
  document_yaml: string;
  document: CanvasDocument;
  digest: string;
  created_at: number;
  source: string;
  summary: string;
};
export type VersionSummary = Omit<Version, 'document' | 'document_yaml'>;
export type SaveResult = { canvas: Canvas; version: Version };
export type Validation = {
  valid: boolean;
  diagnostics: {
    path: string;
    line: number;
    column: number;
    message: string;
  }[];
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
