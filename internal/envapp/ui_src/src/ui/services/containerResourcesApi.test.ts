import { beforeEach, describe, expect, it, vi } from 'vitest';

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApi: vi.fn(),
  fetchLocalApiJSON: vi.fn(),
}));

vi.mock('./localApi', () => localApiMocks);

import {
  createContainerOperation,
  listContainerResources,
  preflightContainerOperation,
  subscribeContainerOperation,
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
  it('keeps engine and opaque endpoint identity on inventory requests', async () => {
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({ compose_projects: [{ project_id: 'project-1' }] });

    await expect(listContainerResources('compose-projects', 'docker', 'endpoint/primary'))
      .resolves.toEqual([{ project_id: 'project-1' }]);

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
      '/_redeven_proxy/api/container-resources/compose-projects?engine=docker&endpoint_id=endpoint%2Fprimary',
      { method: 'GET' },
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
});
