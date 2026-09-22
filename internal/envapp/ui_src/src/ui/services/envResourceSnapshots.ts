import type { HostApplication, HostApplicationCatalog, HostApplicationSession } from './hostApplicationsApi';
import type { ContainerResourceInventoryItem, ContainerResourceView, ContainerRuntime, ContainerService } from './containerResourcesApi';
import type { ManagedService, PortForward } from '../pages/EnvPortForwardsPage';
import type { SpaceStatus } from '../pages/EnvCodespacesPage';

// These allowlists are product presentation contracts, not general API response caching.
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid presentation snapshot');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid presentation collection');
  return value;
}
const booleanFields = new Set(['native_ready', 'supported', 'ready', 'screen_recording', 'accessibility', 'existing_application',
  'rootless', 'remote', 'restart_required', 'collection_stats', 'volume_files', 'exec', 'start', 'stop', 'restart',
  'references_complete', 'saved', 'digest_pinned', 'pending_changes', 'available']);
const numberFields = new Set(['started_at_unix_ms', 'created_at_unix_ms', 'updated_at_unix_ms', 'last_opened_at_unix_ms',
  'last_checked_at_unix_ms', 'latency_ms', 'size_bytes', 'referenced_containers', 'service_count', 'container_count',
  'running_count', 'host_port', 'port', 'container_port', 'runtime_port', 'schema_version']);
const stringListFields = new Set(['requirements', 'sources', 'tags']);
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const source = record(value);
  return Object.fromEntries(names.filter(name => source[name] !== undefined).map(name => {
    const value = source[name];
    const valid = booleanFields.has(name) ? typeof value === 'boolean'
      : numberFields.has(name) ? typeof value === 'number' && Number.isFinite(value)
      : stringListFields.has(name) ? Array.isArray(value) && value.every(item => typeof item === 'string')
      : typeof value === 'string';
    if (!valid) throw new Error(`Invalid presentation field: ${name}`);
    return [name, value];
  }));
}
function identity(value: unknown, name: string): Record<string, unknown> {
  const source = record(value);
  if (typeof source[name] !== 'string' || !source[name]) throw new Error('Missing presentation identity');
  return source;
}
function application(value: unknown): HostApplication {
  const source = identity(value, 'id');
  if (typeof source.name !== 'string' || typeof source.icon !== 'string' || typeof source.description !== 'string'
    || !Array.isArray(source.categories) || source.categories.some(category => typeof category !== 'string')) throw new Error('Invalid application snapshot');
  return { id: source.id as string, name: source.name, description: source.description, categories: source.categories as string[],
    icon: source.icon.startsWith('data:image/png;base64,') ? source.icon : '', custom: source.custom === true };
}
export function hostApplicationSnapshot(value: unknown): HostApplicationCatalog {
  const source = record(value);
  const availability = record(source.availability);
  if (typeof availability.supported !== 'boolean' || typeof availability.ready !== 'boolean') throw new Error('Invalid application availability');
  return {
    availability: {
      ...fields(availability, ['backend', 'native_ready', 'supported', 'ready', 'reason', 'version', 'requirements']),
      ...(availability.permissions ? { permissions: fields(availability.permissions, ['screen_recording', 'accessibility']) } : {}),
    } as HostApplicationCatalog['availability'],
    applications: list(source.applications).map(application),
    sessions: list(source.sessions).map(value => {
      const session = identity(value, 'id');
      if (!['starting', 'running', 'ended', 'failed', 'opened'].includes(String(session.state))) throw new Error('Invalid application state');
      return { ...fields(session, ['id', 'state', 'backend', 'existing_application', 'mode', 'end_reason', 'error_code', 'started_at_unix_ms']),
        application: application(session.application) } as HostApplicationSession;
    }),
    ...(source.running ? { running: list(source.running).map(value => {
      const running = identity(value, 'application_id');
      const instances = list(running.instances);
      if (instances.some(instance => typeof instance !== 'string')) throw new Error('Invalid process identity');
      return { application_id: running.application_id as string, instances: instances as string[] };
    }) } : {}),
  };
}

export function containerRuntimeSnapshot(value: unknown): ContainerRuntime[] {
  return list(value).map(value => {
    const runtime = record(value);
    if (!['docker', 'podman'].includes(String(runtime.engine)) || !['ready', 'not_installed', 'stopped', 'permission', 'unreachable', 'error'].includes(String(runtime.state))) throw new Error('Invalid container runtime');
    if (runtime.state === 'ready') identity(runtime, 'endpoint_id');
    return { ...fields(runtime, ['engine', 'state', 'endpoint_id', 'engine_version', 'rootless']),
      ...(runtime.capabilities ? { capabilities: fields(runtime.capabilities, ['collection_stats', 'volume_files', 'exec']) } : {}),
    } as ContainerRuntime;
  });
}
export function containerServiceSnapshot(value: unknown): ContainerService[] {
  return list(value).map(value => {
    const service = identity(value, 'service_id');
    if (typeof service.name !== 'string' || !['docker', 'podman'].includes(String(service.engine)) || typeof service.state !== 'string') throw new Error('Invalid service snapshot');
    return { ...fields(service, ['service_id', 'engine', 'name', 'implementation', 'state', 'version', 'rootless', 'remote', 'guidance_code', 'restart_required', 'generation']),
      capabilities: fields(service.capabilities, ['start', 'stop', 'restart']),
      configuration: fields(service.configuration, ['mode', 'sources']),
    } as ContainerService;
  });
}
const inventoryFields = {
  containers: ['container_id', 'name', 'image_id', 'state', 'health', 'created_at_unix_ms', 'group_kind', 'group_id', 'group_name'],
  images: ['id', 'reference', 'digest', 'tags', 'size_bytes', 'created_at_unix_ms', 'referenced_containers'],
  volumes: ['name', 'driver', 'scope', 'created_at_unix_ms', 'referenced_containers', 'references_complete'],
  'compose-projects': ['project_id', 'name', 'status', 'service_count', 'container_count', 'running_count', 'saved', 'source'],
  pods: ['pod_id', 'name', 'status', 'infra_id', 'container_count', 'running_count', 'created_at_unix_ms'],
} as const;
export function containerInventorySnapshot(view: ContainerResourceView, value: unknown): ContainerResourceInventoryItem[] {
  return list(value).map(value => {
    const entry = identity(value, inventoryFields[view][0]);
    return { ...fields(entry, inventoryFields[view]),
      ...(entry.image ? { image: fields(entry.image, ['reference', 'digest', 'digest_pinned']) } : {}),
      ...(entry.ports ? { ports: list(entry.ports).map(port => fields(port, ['host_ip', 'host_port', 'port', 'container_port', 'protocol'])) } : {}),
      ...(entry.management ? { management: { managed: record(entry.management).managed === true,
        ...(record(entry.management).owner ? { owner: fields(record(entry.management).owner, ['kind', 'service_id', 'name']) } : {}) } } : {}),
    } as ContainerResourceInventoryItem;
  });
}

export function forwardSnapshot(value: unknown): PortForward[] {
  return list(value).map(value => {
    const forward = identity(value, 'forward_id');
    // Saved target identity is useful presentation; URL credentials and query secrets are not.
    const target = new URL(String(forward.target_url));
    target.username = ''; target.password = ''; target.search = ''; target.hash = '';
    return { ...fields(forward, ['forward_id', 'name', 'description', 'created_at_unix_ms', 'updated_at_unix_ms', 'last_opened_at_unix_ms', 'access_mode']),
      target_url: target.href,
      health: fields(forward.health, ['status', 'last_checked_at_unix_ms', 'latency_ms']),
    } as PortForward;
  });
}
export function managedServiceSnapshot(value: unknown): ManagedService[] {
  return list(value).map(value => {
    const service = identity(value, 'service_id');
    if (typeof service.name !== 'string' || !['host', 'container', 'compose'].includes(String(service.deployment))) throw new Error('Invalid managed service');
    const release = record(service.release_status);
    return { ...fields(service, ['service_id', 'template_id', 'name', 'description', 'template_source', 'default_locale', 'deployment', 'workspace_path', 'workspace_ownership', 'desired_state', 'observed_state', 'forward_id', 'runtime_port', 'access_mode', 'management_state', 'status', 'primary_action', 'problem_code', 'pending_changes']),
      ...(service.icon ? { icon: fields(service.icon, ['media_type', 'data', 'sha256']) } : {}),
      release_status: { ...fields(release, ['schema_version', 'check_status']),
        ...(release.current_release ? { current_release: fields(release.current_release, ['schema_version', 'kind', 'version', 'tag', 'digest', 'platform']) } : {}),
      },
      ...(service.actions ? { actions: Object.fromEntries(Object.entries(record(service.actions)).filter(([key]) => ['start', 'stop', 'restart', 'retry', 'open', 'restore_management', 'inspect', 'recover', 'detach', 'uninstall'].includes(key)).map(([key, action]) => [key, fields(action, ['available', 'reason_code'])])) } : {}),
      ...(service.localizations ? { localizations: Object.fromEntries(Object.entries(record(service.localizations)).map(([key, value]) => [key, fields(value, ['name', 'description'])])) } : {}),
      ...(service.container_resources ? { container_resources: list(service.container_resources).map(value => fields(value, ['kind', 'engine', 'endpoint_id', 'view', 'identity'])) } : {}),
    } as ManagedService;
  });
}

export function codespaceSnapshot(value: unknown): SpaceStatus[] {
  return list(value).map(value => {
    const space = identity(value, 'code_space_id');
    const strings = ['code_space_id', 'name', 'description', 'workspace_path'] as const;
    const numbers = ['code_port', 'created_at_unix_ms', 'updated_at_unix_ms', 'last_opened_at_unix_ms', 'pid'] as const;
    if (strings.some(key => typeof space[key] !== 'string') || typeof space.running !== 'boolean'
      || numbers.some(key => typeof space[key] !== 'number' || !Number.isFinite(space[key]))) throw new Error('Invalid codespace snapshot');
    return Object.fromEntries([...strings, ...numbers, 'running'].map(key => [key, space[key]])) as SpaceStatus;
  });
}
