import { beforeEach, describe, expect, it, vi } from 'vitest';

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApi: vi.fn(),
  fetchLocalApiJSON: vi.fn(),
}));

vi.mock('./localApi', () => localApiMocks);

import {
  createComposeProjectDefinition,
  createContainerOperation,
  deleteComposeProjectDefinition,
  getComposeProjectDefinition,
  getContainerImageHistory,
  getContainerServiceConfiguration,
  getRawContainerInspect,
  listContainerRuntimes,
  listContainerOperationEvents,
  listContainerResourceFiles,
  readContainerResourceFile,
  listContainerResources,
  listContainerServices,
  preflightContainerOperation,
  subscribeContainerOperation,
  subscribeContainerOperationEvents,
  subscribeContainerStatsCollection,
  type ContainerOperation,
  type ContainerPreflight,
} from './containerResourcesApi';

const preflight: ContainerPreflight = {
  method: 'volumes.remove',
  engine: 'docker',
  endpoint_id: 'endpoint/primary',
  resource_kind: 'volume',
  resource_identity: 'cache data',
  request_hash: 'sha256:request',
  plan_hash: 'sha256:plan',
  plan: {
    method: 'volumes.remove',
    target: { name: 'cache data' },
    plan_digest: 'sha256:plan',
    risk_level: 'high',
    risk_flags: [],
    requires_admin: true,
  },
  management: { managed: false },
};

function operation(state: ContainerOperation['state']): ContainerOperation {
  return {
    operation_id: 'container_operation_1',
    request_id: 'request-1',
    request_hash: preflight.request_hash,
    plan_hash: preflight.plan_hash,
    method: preflight.method,
    engine: 'docker',
    endpoint_id: preflight.endpoint_id,
    resource_kind: preflight.resource_kind,
    resource_identity: preflight.resource_identity,
    state,
    cancel_requested: false,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
  };
}

beforeEach(() => {
  localApiMocks.fetchLocalApi.mockReset();
  localApiMocks.fetchLocalApiJSON.mockReset();
});

describe('native container resources API', () => {
  it('discovers all active runtime states without endpoint selection parameters', async () => {
    const signal = new AbortController().signal;
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({
      engines: [
        { engine: 'docker', state: 'ready', endpoint_id: 'opaque-docker' },
        { engine: 'podman', state: 'permission' },
      ],
    });

    await expect(listContainerRuntimes(signal)).resolves.toEqual([
      { engine: 'docker', state: 'ready', endpoint_id: 'opaque-docker' },
      { engine: 'podman', state: 'permission' },
    ]);
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resources/runtimes',
      { method: 'GET', signal },
    );
  });

  it('loads product-safe container services and no-store configuration', async () => {
    const signal = new AbortController().signal;
    const service = {
      service_id: 'container_service_1', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'running',
      capabilities: { start: false, stop: true, restart: true },
      configuration: { mode: 'editable', format: 'json', sections: ['proxy', 'advanced'], owner: 'redeven' },
    };
    const configuration = {
      service_id: service.service_id, format: 'json', content: '{}\n', base_revision: 'sha256:base', restart_required: false,
    };
    localApiMocks.fetchLocalApiJSON.mockResolvedValueOnce({ services: [service] }).mockResolvedValueOnce(configuration);

    await expect(listContainerServices(signal)).resolves.toEqual([service]);
    await expect(getContainerServiceConfiguration(service.service_id)).resolves.toEqual(configuration);
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(1,
      '/_redeven_proxy/api/container-resources/services',
      { method: 'GET', cache: 'no-store', signal },
    );
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(2,
      '/_redeven_proxy/api/container-resources/services/container_service_1/configuration',
      { method: 'GET', cache: 'no-store' },
    );
  });

  it('keeps engine and opaque endpoint identity on inventory requests', async () => {
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({ compose_projects: [{ project_id: 'project-1' }] });
    const signal = new AbortController().signal;

    await expect(listContainerResources('compose-projects', 'docker', 'endpoint/primary', signal))
      .resolves.toEqual([{ project_id: 'project-1' }]);

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resources/compose-projects?engine=docker&endpoint_id=endpoint%2Fprimary',
      { method: 'GET', signal },
    );
  });

  it('submits only the recomputed preflight hashes with the mutation request', async () => {
    const request = { engine: 'docker', endpoint_id: 'endpoint/primary', name: 'cache data' };
    localApiMocks.fetchLocalApiJSON
      .mockResolvedValueOnce(preflight)
      .mockResolvedValueOnce(operation('queued'));

    await expect(preflightContainerOperation(preflight.method, request)).resolves.toEqual(preflight);
    await expect(createContainerOperation(preflight, request)).resolves.toMatchObject({ state: 'queued' });

    const createCall = localApiMocks.fetchLocalApiJSON.mock.calls[1];
    expect(createCall[0]).toBe('/_redeven_proxy/api/container-resource-operations');
    expect(JSON.parse(String(createCall[1]?.body))).toMatchObject({
      method: preflight.method,
      request,
      request_hash: preflight.request_hash,
      plan_hash: preflight.plan_hash,
    });
  });

  it('observes a terminal durable operation event without creating more work', async () => {
    const terminal = operation('interrupted');
    const encoded = new TextEncoder().encode('id: 7\ndata: {"operation_id":"container_operation_1"}\n\n');
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }), { status: 200 }));
    localApiMocks.fetchLocalApiJSON.mockResolvedValue(terminal);
    const observed = vi.fn();

    await subscribeContainerOperation(terminal.operation_id, observed, new AbortController().signal);

    expect(observed).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledWith(terminal);
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resource-operations/container_operation_1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads and streams structured operation progress', async () => {
    const event = {
      sequence: 3,
      operation_id: 'container_operation_1',
      type: 'progress',
      state: 'running' as const,
      payload: { phase: 'pulling', completed: 2, total: 4, unit: 'layers' },
      created_at_unix_ms: 3,
    };
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({ events: [event] });
    await expect(listContainerOperationEvents('container_operation_1')).resolves.toEqual([event]);
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resource-operations/container_operation_1/events/snapshot?after_sequence=0',
      { method: 'GET' },
    );

    const encoded = new TextEncoder().encode(`id: 3\nevent: operation\ndata: ${JSON.stringify(event)}\n\n`);
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }), { status: 200 }));
    const observed = vi.fn();
    await subscribeContainerOperationEvents('container_operation_1', observed, new AbortController().signal, 2);
    expect(observed).toHaveBeenCalledWith(event);
    expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resource-operations/container_operation_1/events?after_sequence=2',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'text/event-stream' } }),
    );
  });

  it('uses explicit saved Compose project definition routes', async () => {
    const input = {
      engine: 'docker' as const,
      endpoint_id: 'endpoint/primary',
      name: 'saved-api',
      config_paths: ['/workspace/compose.yaml'],
      profiles: ['dev'],
    };
    const definition = { ...input, project_id: 'compose_saved_1', created_at_unix_ms: 1, updated_at_unix_ms: 1 };
    localApiMocks.fetchLocalApiJSON
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce({ project_id: definition.project_id });

    await expect(createComposeProjectDefinition(input)).resolves.toEqual(definition);
    await expect(getComposeProjectDefinition(definition.project_id, 'docker', input.endpoint_id)).resolves.toEqual(definition);
    await expect(deleteComposeProjectDefinition(definition.project_id)).resolves.toBeUndefined();

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(1,
      '/_redeven_proxy/api/container-resources/compose-projects',
      { method: 'POST', body: JSON.stringify(input) },
    );
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(2,
      '/_redeven_proxy/api/container-resources/compose-projects/compose_saved_1/definition?engine=docker&endpoint_id=endpoint%2Fprimary',
      { method: 'GET', cache: 'no-store' },
    );
  });

  it('uses no-store reads for explicit raw inspect and Podman volume files', async () => {
    localApiMocks.fetchLocalApiJSON
      .mockResolvedValueOnce({ Config: { Image: 'alpine:3.22' } })
      .mockResolvedValueOnce({ path: '/etc', entries: [{ name: 'hosts', path: '/etc/hosts', kind: 'file' }], truncated: false });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response('127.0.0.1 localhost', { status: 200 }));

    await expect(getRawContainerInspect('container/one', 'docker', 'endpoint/primary')).resolves.toMatchObject({ Config: { Image: 'alpine:3.22' } });
    await expect(listContainerResourceFiles('volumes', 'container/one', '/etc', 'podman', 'endpoint/primary')).resolves.toMatchObject({ path: '/etc' });
    await expect(readContainerResourceFile('volumes', 'container/one', '/etc/hosts', 'podman', 'endpoint/primary')).resolves.toMatchObject({ size: 19 });

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(1,
      '/_redeven_proxy/api/container-resources/containers/container%2Fone/inspect/raw?engine=docker&endpoint_id=endpoint%2Fprimary',
      { method: 'GET', cache: 'no-store' },
    );
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenNthCalledWith(2,
      '/_redeven_proxy/api/container-resources/volumes/container%2Fone/files?engine=podman&path=%2Fetc&endpoint_id=endpoint%2Fprimary',
      { method: 'GET', cache: 'no-store' },
    );
    expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resources/volumes/container%2Fone/files/content?engine=podman&path=%2Fetc%2Fhosts&endpoint_id=endpoint%2Fprimary',
      { method: 'GET', cache: 'no-store' },
    );
  });

  it('keeps image history safe and observes endpoint-wide stats from one SSE stream', async () => {
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({ history: [{ id: 'layer-1', size_bytes: 1024, created_at_unix_ms: 1 }] });
    await expect(getContainerImageHistory('alpine:3.22', 'podman', 'rootless')).resolves.toHaveLength(1);

    const encoded = new TextEncoder().encode('event: stats\ndata: {"sampled_at_unix_ms":10,"samples":[{"container_id":"one","cpu_percent":3,"memory_bytes":1024}]}\n\n');
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }), { status: 200 }));
    const observed = vi.fn();
    await subscribeContainerStatsCollection('podman', 'rootless', observed, new AbortController().signal);

    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ samples: [expect.objectContaining({ container_id: 'one' })] }));
    expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resources/containers/stats/events?engine=podman&interval_ms=1500&endpoint_id=rootless',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'text/event-stream' } }),
    );
  });
});
