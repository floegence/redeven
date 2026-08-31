import { fetchLocalApi, fetchLocalApiJSON } from './localApi';

export type ContainerEngine = 'docker' | 'podman';
export type ContainerResourceView = 'containers' | 'images' | 'volumes' | 'compose-projects' | 'pods';
export type ContainerOperationState = 'queued' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled' | 'interrupted';

export type ContainerRuntimeState = 'ready' | 'not_installed' | 'stopped' | 'permission' | 'unreachable' | 'error';

export type ContainerRuntimeCapabilities = Readonly<{
  collection_stats: boolean;
  volume_files: boolean;
  exec: boolean;
}>;

export type ReadyContainerRuntime = Readonly<{
  engine: ContainerEngine;
  state: 'ready';
  endpoint_id: string;
  engine_version?: string;
  rootless?: boolean;
  capabilities?: ContainerRuntimeCapabilities;
}>;

export type ContainerRuntime =
  | ReadyContainerRuntime
  | Readonly<{
      engine: ContainerEngine;
      state: Exclude<ContainerRuntimeState, 'ready'>;
    }>;

export type ContainerServiceState = 'running' | 'stopped' | 'not_installed' | 'permission' | 'unreachable' | 'error';
export type ContainerServiceImplementation = 'docker_desktop' | 'docker_engine' | 'podman_machine' | 'podman_local' | 'remote' | 'unavailable';
export type ContainerServiceConfigurationKind = 'json' | 'toml';
export type ContainerServiceConfigurationSourceID = 'engine' | 'client_proxy';
export type ContainerServiceConfigurationAccess =
  | Readonly<{
      mode: 'local';
      sources: readonly ContainerServiceConfigurationSourceID[];
    }>
  | Readonly<{
      mode: 'unavailable';
    }>;

export type ContainerService = Readonly<{
  service_id: string;
  engine: ContainerEngine;
  name: string;
  implementation: ContainerServiceImplementation;
  state: ContainerServiceState;
  version?: string;
  rootless?: boolean;
  remote?: boolean;
  guidance_code?: 'install' | 'permission' | 'start_official' | 'check_active' | 'detection_failed' | 'select_docker_context' | 'externally_managed' | 'host_manager' | 'podman_daemonless' | 'podman_machine_managed' | 'remote_host';
  capabilities: Readonly<{
    start: boolean;
    stop: boolean;
    restart: boolean;
  }>;
  configuration: ContainerServiceConfigurationAccess;
  restart_required?: boolean;
  generation?: string;
}>;

export type ContainerServiceConfiguration = Readonly<{
  service_id: string;
  sources: readonly ContainerServiceConfigurationSource[];
}>;

export type ContainerServiceConfigurationSource = Readonly<{
  source_id: ContainerServiceConfigurationSourceID;
  display_path: string;
  status: 'ready' | 'missing' | 'permission' | 'invalid' | 'unsupported';
  exists: boolean;
  format: ContainerServiceConfigurationKind;
  sections: readonly ('proxy' | 'advanced')[];
  apply_modes: readonly ('save' | 'save_and_restart')[];
  content?: string;
  base_revision?: string;
  http_proxy?: string;
  https_proxy?: string;
  no_proxy?: string;
  restart_required?: boolean;
}>;

export type ContainerManagement = Readonly<{
  managed: boolean;
  owner?: Readonly<{ kind: 'web_service'; service_id: string; name: string }>;
}>;

export type ContainerInventoryItem = Readonly<{
  container_id: string;
  name?: string;
  image_id?: string;
  image?: Readonly<{ reference?: string; digest?: string; digest_pinned?: boolean }>;
  state: string;
  health?: string;
  created_at_unix_ms?: number;
  ports?: readonly unknown[];
  group_kind?: string;
  group_id?: string;
  group_name?: string;
  management: ContainerManagement;
}>;

export type ImageInventoryItem = Readonly<{
  id: string;
  reference?: string;
  digest?: string;
  tags?: readonly string[];
  size_bytes?: number;
  created_at_unix_ms?: number;
  referenced_containers: number;
}>;

export type VolumeInventoryItem = Readonly<{
  name: string;
  driver?: string;
  scope?: string;
  created_at_unix_ms?: number;
  referenced_containers: number;
  management: ContainerManagement;
}>;

export type ComposeProjectInventoryItem = Readonly<{
  project_id: string;
  name: string;
  status: string;
  service_count: number;
  container_count: number;
  running_count: number;
  management: ContainerManagement;
  saved: boolean;
  source?: string;
}>;

export type ComposeProjectDefinitionInput = Readonly<{
  engine: 'docker';
  endpoint_id: string;
  name: string;
  config_paths: readonly string[];
  env_file_path?: string;
  profiles?: readonly string[];
}>;

export type ComposeProjectDefinition = ComposeProjectDefinitionInput & Readonly<{
  project_id: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
}>;

export type PodInventoryItem = Readonly<{
  pod_id: string;
  name: string;
  status: string;
  infra_id?: string;
  container_count: number;
  running_count: number;
  created_at_unix_ms?: number;
}>;

export type ContainerResourceInventoryItem =
  | ContainerInventoryItem
  | ImageInventoryItem
  | VolumeInventoryItem
  | ComposeProjectInventoryItem
  | PodInventoryItem;

export type ContainerRiskFlag = Readonly<{
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail?: string;
  admin_required?: boolean;
}>;

export type ContainerPreflight = Readonly<{
  method: string;
  engine: ContainerEngine;
  endpoint_id?: string;
  resource_kind: string;
  resource_identity: string;
  request_hash: string;
  plan_hash: string;
  plan: Readonly<{
    method: string;
    target: Readonly<Record<string, unknown>>;
    plan_digest: string;
    summary?: readonly string[];
    risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
    risk_flags: readonly ContainerRiskFlag[];
    requires_admin: boolean;
  }>;
  management: ContainerManagement;
}>;

export type ContainerOperation = Readonly<{
  operation_id: string;
  request_id: string;
  request_hash: string;
  plan_hash: string;
  method: string;
  engine: ContainerEngine;
  endpoint_id?: string;
  resource_kind: string;
  resource_identity: string;
  state: ContainerOperationState;
  cancel_requested: boolean;
  error_code?: string;
  error_message?: string;
  reconciliation?: Readonly<Record<string, unknown>>;
  created_at_unix_ms: number;
  started_at_unix_ms?: number;
  finished_at_unix_ms?: number;
  updated_at_unix_ms: number;
}>;

export type ContainerOperationEvent = Readonly<{
  sequence: number;
  operation_id: string;
  type: string;
  state: ContainerOperationState;
  payload?: Readonly<Record<string, unknown>>;
  created_at_unix_ms: number;
}>;

export type ContainerLogLine = Readonly<{ timestamp_unix_ms?: number; message: string }>;
export type ContainerStats = Readonly<{
	sampled_at_unix_ms?: number;
  container_id: string;
  cpu_percent: number;
  memory_bytes: number;
  memory_limit: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
}>;

export type ContainerStatsCollection = Readonly<{
	sampled_at_unix_ms: number;
	samples: readonly ContainerStats[];
}>;

export type ContainerImageHistoryEntry = Readonly<{
	id?: string;
	created_at_unix_ms?: number;
	size_bytes?: number;
}>;

export type ContainerResourceFileEntry = Readonly<{
	name: string;
	path: string;
	kind: 'directory' | 'file' | 'link';
	size_bytes?: number;
	mode?: string;
	modified_at_unix_ms?: number;
}>;

export type ContainerResourceFileListing = Readonly<{
	path: string;
	entries: readonly ContainerResourceFileEntry[];
	truncated: boolean;
}>;

export type ContainerExecSession = Readonly<{
  session_id: string;
}>;

function query(engine: ContainerEngine, endpointID: string, extras: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams({ engine, ...extras });
  if (endpointID) params.set('endpoint_id', endpointID);
  return params.toString();
}
export async function listContainerRuntimes(signal?: AbortSignal): Promise<ContainerRuntime[]> {
  const response = await fetchLocalApiJSON<{ engines: ContainerRuntime[] }>(
    '/_redeven_proxy/api/container-resources/runtimes',
    { method: 'GET', signal },
  );
  return response.engines ?? [];
}

export async function createContainerExecSession(
  identity: string,
  engine: ContainerEngine,
  endpointID: string,
  argv: readonly string[],
): Promise<ContainerExecSession> {
  return fetchLocalApiJSON<ContainerExecSession>(
    `/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/exec-sessions`,
    {
      method: 'POST',
      body: JSON.stringify({ engine, endpoint_id: endpointID, argv }),
    },
  );
}

export async function deleteContainerExecSession(sessionID: string): Promise<void> {
  await fetchLocalApiJSON<{ session_id: string }>(
    `/_redeven_proxy/api/container-resources/exec-sessions/${encodeURIComponent(sessionID)}`,
    { method: 'DELETE' },
  );
}

export async function listContainerResources(
  view: ContainerResourceView,
  engine: ContainerEngine,
  endpointID: string,
  signal?: AbortSignal,
): Promise<ContainerResourceInventoryItem[]> {
  const response = await fetchLocalApiJSON<Record<string, ContainerResourceInventoryItem[]>>(
    `/_redeven_proxy/api/container-resources/${view}?${query(engine, endpointID, view === 'containers' ? { all: 'true' } : {})}`,
    { method: 'GET', signal },
  );
  const key = view === 'compose-projects' ? 'compose_projects' : view;
  return response[key] ?? [];
}

export async function getContainerResourceDetails(
  view: ContainerResourceView,
  identity: string,
  engine: ContainerEngine,
  endpointID: string,
): Promise<unknown> {
  return fetchLocalApiJSON<unknown>(
    `/_redeven_proxy/api/container-resources/${view}/${encodeURIComponent(identity)}?${query(engine, endpointID)}`,
    { method: 'GET' },
  );
}

export async function tailContainerLogs(
  identity: string,
  engine: ContainerEngine,
  endpointID: string,
): Promise<ContainerLogLine[]> {
  const response = await fetchLocalApiJSON<{ lines: ContainerLogLine[] }>(
    `/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/logs?${query(engine, endpointID, { tail: '400' })}`,
    { method: 'GET' },
  );
  return response.lines ?? [];
}

export async function getContainerStats(
  identity: string,
  engine: ContainerEngine,
  endpointID: string,
): Promise<ContainerStats> {
  return fetchLocalApiJSON<ContainerStats>(
    `/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/stats?${query(engine, endpointID)}`,
    { method: 'GET' },
  );
}

export async function getContainerImageHistory(
	identity: string,
	engine: ContainerEngine,
	endpointID: string,
): Promise<ContainerImageHistoryEntry[]> {
	const response = await fetchLocalApiJSON<{ history: ContainerImageHistoryEntry[] }>(
		`/_redeven_proxy/api/container-resources/images/${encodeURIComponent(identity)}/history?${query(engine, endpointID)}`,
		{ method: 'GET' },
	);
	return response.history ?? [];
}

export async function getRawContainerInspect(identity: string, engine: ContainerEngine, endpointID: string): Promise<unknown> {
	return fetchLocalApiJSON<unknown>(
		`/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/inspect/raw?${query(engine, endpointID)}`,
		{ method: 'GET', cache: 'no-store' },
	);
}

export async function listContainerResourceFiles(
	view: 'volumes',
	identity: string,
	path: string,
	engine: ContainerEngine,
	endpointID: string,
): Promise<ContainerResourceFileListing> {
	return fetchLocalApiJSON<ContainerResourceFileListing>(
		`/_redeven_proxy/api/container-resources/${view}/${encodeURIComponent(identity)}/files?${query(engine, endpointID, { path })}`,
		{ method: 'GET', cache: 'no-store' },
	);
}

export async function readContainerResourceFile(
	view: 'volumes',
	identity: string,
	path: string,
	engine: ContainerEngine,
	endpointID: string,
): Promise<Blob> {
	const response = await fetchLocalApi(
		`/_redeven_proxy/api/container-resources/${view}/${encodeURIComponent(identity)}/files/content?${query(engine, endpointID, { path })}`,
		{ method: 'GET', cache: 'no-store' },
	);
	if (!response.ok) throw new Error('The resource file could not be read.');
	return response.blob();
}

async function subscribeContainerSSE<T>(
	url: string,
	eventType: string,
	onEvent: (event: T) => void,
	signal: AbortSignal,
): Promise<void> {
	const response = await fetchLocalApi(url, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal });
	if (!response.ok || !response.body) throw new Error('The container stream is unavailable.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });
			const events = buffer.split(/\r?\n\r?\n/u);
			buffer = events.pop() ?? '';
			for (const event of events) {
				const lines = event.split(/\r?\n/u);
				const kind = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
				if (kind !== eventType) continue;
				const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
				if (data) onEvent(JSON.parse(data) as T);
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

export function subscribeContainerLogs(
	identity: string,
	engine: ContainerEngine,
	endpointID: string,
	onEvent: (line: ContainerLogLine) => void,
	signal: AbortSignal,
): Promise<void> {
	return subscribeContainerSSE(
		`/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/logs/events?${query(engine, endpointID, { tail: '400' })}`,
		'log', onEvent, signal,
	);
}

export function subscribeContainerStatsCollection(
	engine: ContainerEngine,
	endpointID: string,
	onEvent: (stats: ContainerStatsCollection) => void,
	signal: AbortSignal,
): Promise<void> {
	return subscribeContainerSSE(
		`/_redeven_proxy/api/container-resources/containers/stats/events?${query(engine, endpointID, { interval_ms: '1500' })}`,
		'stats', onEvent, signal,
	);
}

export function subscribeContainerStats(
	identity: string,
	engine: ContainerEngine,
	endpointID: string,
	onEvent: (stats: ContainerStats) => void,
	signal: AbortSignal,
): Promise<void> {
	return subscribeContainerSSE(
		`/_redeven_proxy/api/container-resources/containers/${encodeURIComponent(identity)}/stats/events?${query(engine, endpointID, { interval_ms: '1000' })}`,
		'stats', onEvent, signal,
	);
}

export async function preflightContainerOperation(method: string, request: unknown): Promise<ContainerPreflight> {
  return fetchLocalApiJSON<ContainerPreflight>('/_redeven_proxy/api/container-resources/preflights', {
    method: 'POST',
    body: JSON.stringify({ method, request }),
  });
}

export async function createContainerOperation(
  preflight: ContainerPreflight,
  request: unknown,
): Promise<ContainerOperation> {
  return fetchLocalApiJSON<ContainerOperation>('/_redeven_proxy/api/container-resource-operations', {
    method: 'POST',
    body: JSON.stringify({
      request_id: `envapp-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
      method: preflight.method,
      request,
      request_hash: preflight.request_hash,
      plan_hash: preflight.plan_hash,
    }),
  });
}

export async function listContainerOperations(): Promise<ContainerOperation[]> {
  const response = await fetchLocalApiJSON<{ operations: ContainerOperation[] }>(
    '/_redeven_proxy/api/container-resource-operations?limit=100',
    { method: 'GET' },
  );
  return response.operations ?? [];
}

export async function listContainerServices(signal?: AbortSignal): Promise<ContainerService[]> {
  const response = await fetchLocalApiJSON<{ services: ContainerService[] }>(
    '/_redeven_proxy/api/container-resources/services',
    { method: 'GET', cache: 'no-store', signal },
  );
  return response.services ?? [];
}

export async function getContainerServiceConfiguration(serviceID: string): Promise<ContainerServiceConfiguration> {
  return fetchLocalApiJSON<ContainerServiceConfiguration>(
    `/_redeven_proxy/api/container-resources/services/${encodeURIComponent(serviceID)}/configuration`,
    { method: 'GET', cache: 'no-store' },
  );
}

export async function listContainerOperationEvents(operationID: string): Promise<ContainerOperationEvent[]> {
  const response = await fetchLocalApiJSON<{ events: ContainerOperationEvent[] }>(
    `/_redeven_proxy/api/container-resource-operations/${encodeURIComponent(operationID)}/events/snapshot?after_sequence=0`,
    { method: 'GET' },
  );
  return response.events ?? [];
}

export async function createComposeProjectDefinition(input: ComposeProjectDefinitionInput): Promise<ComposeProjectDefinition> {
  return fetchLocalApiJSON<ComposeProjectDefinition>('/_redeven_proxy/api/container-resources/compose-projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateComposeProjectDefinition(projectID: string, input: ComposeProjectDefinitionInput): Promise<ComposeProjectDefinition> {
  return fetchLocalApiJSON<ComposeProjectDefinition>(
    `/_redeven_proxy/api/container-resources/compose-projects/${encodeURIComponent(projectID)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
}

export async function getComposeProjectDefinition(
  projectID: string,
  engine: ContainerEngine,
  endpointID: string,
): Promise<ComposeProjectDefinition> {
  return fetchLocalApiJSON<ComposeProjectDefinition>(
    `/_redeven_proxy/api/container-resources/compose-projects/${encodeURIComponent(projectID)}/definition?${query(engine, endpointID)}`,
    { method: 'GET', cache: 'no-store' },
  );
}

export async function deleteComposeProjectDefinition(projectID: string): Promise<void> {
  await fetchLocalApiJSON<{ project_id: string }>(
    `/_redeven_proxy/api/container-resources/compose-projects/${encodeURIComponent(projectID)}`,
    { method: 'DELETE' },
  );
}

export async function cancelContainerOperation(operationID: string): Promise<ContainerOperation> {
  return fetchLocalApiJSON<ContainerOperation>(
    `/_redeven_proxy/api/container-resource-operations/${encodeURIComponent(operationID)}/cancel`,
    { method: 'POST' },
  );
}

export async function subscribeContainerOperation(
  operationID: string,
  onEvent: (operation: ContainerOperation) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetchLocalApi(
    `/_redeven_proxy/api/container-resource-operations/${encodeURIComponent(operationID)}/events`,
    { method: 'GET', headers: { Accept: 'text/event-stream' }, signal },
  );
  if (!response.ok || !response.body) throw new Error('Container operation stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/u);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event.split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data) as { operation_id?: string };
        if (!parsed.operation_id) continue;
        const latest = await fetchLocalApiJSON<ContainerOperation>(
          `/_redeven_proxy/api/container-resource-operations/${encodeURIComponent(operationID)}`,
          { method: 'GET', signal },
        );
        onEvent(latest);
        if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(latest.state)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function subscribeContainerOperationEvents(
  operationID: string,
  onEvent: (event: ContainerOperationEvent) => void,
  signal: AbortSignal,
  afterSequence = 0,
): Promise<void> {
  await subscribeContainerSSE<ContainerOperationEvent>(
    `/_redeven_proxy/api/container-resource-operations/${encodeURIComponent(operationID)}/events?after_sequence=${afterSequence}`,
    'operation',
    onEvent,
    signal,
  );
}
