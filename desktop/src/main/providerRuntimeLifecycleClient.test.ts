import { describe, expect, it, vi } from 'vitest';

import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';
import type {
  DesktopProviderTransport,
  DesktopProviderTransportResponse,
} from './controlPlaneProviderTransport';
import { ProviderRuntimeLifecycleClient, type ProviderRuntimeLifecycleScope } from './providerRuntimeLifecycleClient';
import type { GatewaySecretStore } from './gatewayTrust';

function response(body: unknown): DesktopProviderTransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body_text: JSON.stringify(body),
  };
}

function tunnelResponse(data: unknown): DesktopProviderTransportResponse {
  return response({
    protocol_version: 'rcpp-v3',
    status_code: 200,
    content_type: 'application/json',
    body_b64u: Buffer.from(JSON.stringify({ ok: true, data }), 'utf8').toString('base64url'),
  });
}

function scope(): ProviderRuntimeLifecycleScope {
  const provider = normalizeDesktopControlPlaneProvider({
    protocol_version: 'rcpp-v3',
    provider_id: 'provider_demo',
    display_name: 'Demo Provider',
    provider_origin: 'https://provider.example',
    documentation_url: 'https://provider.example/help',
    access_points: [{
      access_point_id: 'ap_demo',
      region: 'dev',
      display_name: 'Development',
      description: 'Development access point',
      access_point_origin: 'https://ap.provider.example',
      country_code: 'SG',
      city: 'Singapore',
      status: 'active',
      health_status: 'healthy',
    }],
  });
  if (!provider) throw new Error('provider fixture is invalid');
  return {
    provider,
    access_point: provider.access_points[0]!,
    access_token: 'provider-access-token',
    env_public_id: 'env_demo',
    lifecycle_target_id: 'target_demo',
    target_generation: 7,
  };
}

function operation(state: 'awaiting_artifact' | 'staging') {
  return {
    protocol_version: 'redeven-gateway-v2',
    operation_id: 'rop_demo',
    idempotency_key: 'idem_demo',
    lifecycle_target_id: 'target_demo',
    target_generation: 7,
    gateway_env_id: 'env_local',
    kind: 'update_runtime',
    authorized_client_key_id: 'gck_demo',
    desired_runtime: {
      version: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
      artifact_policy: 'published_release',
    },
    state,
    expected_snapshot: {
      snapshot_revision: 1,
      process_inventory_digest: 'a'.repeat(64),
      workload_identity_digest: 'b'.repeat(64),
      workload: {
        knowledge: 'known',
        affected_process_count: 0,
        active_session_count: 0,
        protected_workload_present: false,
      },
      observed_at_unix_ms: 1_700_000_000_000,
    },
    created_at_unix_ms: 1_700_000_000_000,
    updated_at_unix_ms: 1_700_000_000_001,
  };
}

function memorySecretStore() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const store: GatewaySecretStore = {
    readSecret: (key) => {
      reads.push(key);
      return values.get(key) ?? '';
    },
    writeSecret: (key, value) => {
      values.set(key, value);
    },
    deleteSecret: (key) => {
      values.delete(key);
    },
  };
  return { store, values, reads };
}

describe('ProviderRuntimeLifecycleClient', () => {
  it('uses a Provider-scoped client key without reading a Gateway paired key', async () => {
    const secrets = memorySecretStore();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValue(tunnelResponse({
      protocol_version: 'redeven-gateway-v2',
      operation: operation('awaiting_artifact'),
      confirmation_required: false,
      artifact_max_bytes: 512 * 1024 * 1024,
    }));
    const client = new ProviderRuntimeLifecycleClient(secrets.store, transport);
    const target = scope();
    const clientKeyID = await client.clientKeyID(target);

    await client.prepareRuntimeOperation(target, {
      operation_id: 'rop_demo',
      authorized_client_key_id: clientKeyID,
      gateway_env_id: 'env_local',
      lifecycle_target_id: target.lifecycle_target_id,
      target_generation: target.target_generation,
      operation: 'update_runtime',
      desired_runtime: {
        version: 'v1.2.3',
        platform: 'linux',
        architecture: 'amd64',
        artifact_policy: 'published_release',
      },
      idempotency_key: 'idem_demo',
      authorization_permit: 'permit_demo',
    });

    expect(clientKeyID).toMatch(/^gck_/u);
    expect([...secrets.values.keys()]).toEqual([expect.stringMatching(/^provider-runtime-client-key:/u)]);
    expect(secrets.reads.every((key) => key.startsWith('provider-runtime-client-key:'))).toBe(true);
    expect(secrets.reads.join('\n')).not.toContain('paired');
    const call = transport.mock.calls[0]![0];
    expect(call.url).toBe('https://ap.provider.example/api/rcpp/v3/environments/env_demo/runtime-management/tunnel');
    expect(call.headers?.authorization).toBe('Bearer provider-access-token');
    expect(JSON.parse(call.body_text ?? '')).toMatchObject({
      protocol_version: 'rcpp-v3',
      env_public_id: 'env_demo',
      lifecycle_target_id: 'target_demo',
      target_generation: 7,
      client_key_id: clientKeyID,
      method: 'POST',
      route: '/gateway/v2/runtime-operations/prepare',
    });
  });

  it('uploads contiguous Provider tunnel chunks and marks only the last chunk final', async () => {
    const secrets = memorySecretStore();
    const transport = vi.fn<DesktopProviderTransport>()
      .mockResolvedValueOnce(tunnelResponse(null))
      .mockResolvedValueOnce(tunnelResponse(operation('staging')));
    const client = new ProviderRuntimeLifecycleClient(secrets.store, transport);
    const artifact = Buffer.alloc(300 * 1024, 0x5a);
    const archiveSHA = 'c'.repeat(64);
    const executableSHA = 'd'.repeat(64);

    await client.uploadRuntimeOperationArtifact(scope(), 'rop_demo', {
      size_bytes: artifact.length,
      archive_sha256: archiveSHA,
      executable_sha256: executableSHA,
      manifest: { schema_version: 1 },
      manifest_signature: 'signature',
      manifest_certificate: 'certificate',
    }, artifact);

    expect(transport).toHaveBeenCalledTimes(2);
    const chunks = transport.mock.calls.map(([request]) => JSON.parse(request.body_text ?? '').artifact_upload);
    expect(chunks).toEqual([
      expect.objectContaining({ offset: 0, total_size: artifact.length, final: false }),
      expect.objectContaining({ offset: 256 * 1024, total_size: artifact.length, final: true }),
    ]);
    expect(chunks[0].upload_id).toBe(chunks[1].upload_id);
    expect(chunks[0].metadata_b64u).toBe(chunks[1].metadata_b64u);
  });

  it('sends an exact reconciliation permit through the Provider management tunnel', async () => {
    const secrets = memorySecretStore();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValue(tunnelResponse({
      ...operation('staging'),
      state: 'failed',
      failure: { code: 'recovery_failed', message: 'Recovery was reconciled.' },
    }));
    const client = new ProviderRuntimeLifecycleClient(secrets.store, transport);

    await expect(client.reconcileRuntimeOperation(scope(), 'rop_demo', {
      authorization_permit: 'exact-reconcile-permit',
    })).resolves.toMatchObject({ operation_id: 'rop_demo', state: 'failed' });

    const tunnel = JSON.parse(transport.mock.calls[0]![0].body_text ?? '');
    expect(tunnel.route).toBe('/gateway/v2/runtime-operations/rop_demo/reconcile');
    expect(tunnel.method).toBe('POST');
    expect(JSON.parse(Buffer.from(tunnel.body_b64u, 'base64url').toString('utf8'))).toEqual({
      protocol_version: 'redeven-gateway-v2',
      authorization_permit: 'exact-reconcile-permit',
    });
    expect(JSON.stringify(tunnel)).not.toContain('force');
    expect(secrets.reads.every((key) => key.startsWith('provider-runtime-client-key:'))).toBe(true);
  });
});
