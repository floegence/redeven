import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GatewayStore,
  defaultGatewayStorePath,
  gatewayBindingAudience,
  gatewayRecordToSource,
  gatewayRecordToLocalEnvironment,
  gatewayRecordToSourceWithCatalog,
  gatewayRecordToSourceWithError,
  normalizeGatewayBaseURL,
  normalizeGatewayStoreSnapshot,
  stableGatewayID,
  type GatewayRecord,
} from './gatewayStore';

async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-store-test-'));
}

describe('GatewayStore', () => {
  const cleanupRoots = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupRoots, async (root) => {
      await fs.rm(root, { recursive: true, force: true });
      cleanupRoots.delete(root);
    }));
  });

  it('projects a direct managed card into the local lifecycle environment', () => {
    const environment = gatewayRecordToLocalEnvironment({
      schema_version: 2,
      gateway_id: 'gw_direct',
      display_name: 'Direct Runtime management',
      runtime_environment_id: 'local:local',
      local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/redeven' },
      created_at_ms: 1,
      updated_at_ms: 1,
    }, {
      support: 'supported',
      authorization: { state: 'allowed', grants: ['manage_runtime'] },
      readiness: 'ready',
      presentation_state: 'allowed',
      target: { lifecycle_target_id: 'target-direct', target_generation: 4 },
      operations: ['start', 'restart', 'update_runtime'],
      artifact_policies: ['published_release'],
      checked_at_unix_ms: 10,
    });

    expect(environment).toMatchObject({
      gateway_env_id: 'env_local',
      env_kind: 'managed_local_env',
      capabilities: ['start', 'restart', 'update_runtime'],
      control_capabilities: ['start', 'restart', 'update_runtime'],
      runtime_management: {
        readiness: 'ready',
        target: { lifecycle_target_id: 'target-direct', target_generation: 4 },
      },
    });
  });

  it('persists URL Gateway records without writing private keys or pairing secrets', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Bastion Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://gateway.example.internal/path?bearer=leak',
      },
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: 'gck_demo',
        paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
        gateway_id: 'gw_demo',
        gateway_public_key: 'PUBLIC KEY',
        gateway_public_key_fingerprint: 'SHA256:fingerprint',
        binding_audience: 'https://gateway.example.internal/path/',
        created_at_unix_ms: 1_770_000_000_000,
      },
      now_ms: 1_770_000_000_000,
    });

    const raw = await fs.readFile(defaultGatewayStorePath(root), 'utf8');
    expect(raw).toContain('paired_client_private_key_ref');
    expect(raw).not.toContain('PRIVATE KEY');
    expect(raw).not.toContain('pairing_code');
    expect(raw).not.toContain('bearer=leak');
    expect(raw).not.toContain('provider-token');
    expect(raw).not.toContain('runtime-control-token');

    const loaded = await new GatewayStore(defaultGatewayStorePath(root)).get('gw_demo');
    expect(loaded?.connection).toEqual({
      kind: 'url',
      base_url: 'https://gateway.example.internal/path/',
      allow_loopback_http: false,
    });
  });

  it('returns a diagnostic error for corrupted store JSON', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{broken', 'utf8');

    await expect(new GatewayStore(filePath).load()).rejects.toMatchObject({
      code: 'GATEWAY_STORE_INVALID_JSON',
      filePath,
    });
  });

  it('initializes fresh stores at schema v2', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    const store = new GatewayStore(filePath);

    expect(await store.load()).toEqual({ schema_version: 2, gateways: [] });
    await store.upsert({
      gateway_id: 'gw_fresh',
      display_name: 'Fresh Gateway',
      connection: { kind: 'local_host', runtime_root: '/tmp/redeven' },
      now_ms: 10,
    });

    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toMatchObject({
      schema_version: 2,
      gateways: [expect.objectContaining({ schema_version: 2, gateway_id: 'gw_fresh' })],
    });
  });

  it('persists the originating direct Runtime card without exposing it on ordinary Gateway records', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    const store = new GatewayStore(filePath);

    await store.upsert({
      gateway_id: 'gw_direct',
      display_name: 'Devbox Runtime management',
      runtime_environment_id: 'ssh:devbox:default:key_agent:remote_default',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'devbox',
        auth_mode: 'key_agent',
        runtime_root: '~/.redeven',
      },
      now_ms: 10,
    });
    await store.upsert({
      gateway_id: 'gw_ordinary',
      display_name: 'Shared Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://gateway.example/',
      },
      now_ms: 20,
    });

    const reloaded = new GatewayStore(filePath);
    expect(await reloaded.get('gw_direct')).toMatchObject({
      runtime_environment_id: 'ssh:devbox:default:key_agent:remote_default',
    });
    expect(await reloaded.get('gw_ordinary')).not.toHaveProperty('runtime_environment_id');
  });

  it('clears a direct Runtime card mapping when the same Gateway becomes an explicit record', async () => {
	const root = await createTempRoot();
	cleanupRoots.add(root);
	const store = new GatewayStore(defaultGatewayStorePath(root));

	await store.upsert({
	  gateway_id: 'gw_reused',
	  display_name: 'Direct Runtime management',
	  runtime_environment_id: 'ssh:devbox:default:key_agent:remote_default',
	  connection: { kind: 'ssh_host', ssh_destination: 'devbox', runtime_root: '~/.redeven' },
	  now_ms: 10,
	});
	const explicit = await store.upsert({
	  gateway_id: 'gw_reused',
	  display_name: 'Shared Gateway',
	  runtime_environment_id: null,
	  connection: { kind: 'ssh_host', ssh_destination: 'devbox', runtime_root: '~/.redeven' },
	  now_ms: 20,
	});

	expect(explicit).not.toHaveProperty('runtime_environment_id');
	expect(await new GatewayStore(defaultGatewayStorePath(root)).get('gw_reused')).not.toHaveProperty('runtime_environment_id');
  });

  it('migrates the exact v1 store to v2 and preserves user records', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify({
      schema_version: 1,
      gateways: [{
        schema_version: 1,
        gateway_id: 'gw_v1',
        display_name: 'Existing Gateway',
        local_enabled: false,
        connection: { kind: 'url', base_url: 'https://gateway.example/' },
        created_at_ms: 10,
        updated_at_ms: 20,
      }],
    }, null, 2)}\n`, 'utf8');

    const snapshot = await new GatewayStore(filePath).load();

    expect(snapshot).toMatchObject({
      schema_version: 2,
      gateways: [{
        schema_version: 2,
        gateway_id: 'gw_v1',
        display_name: 'Existing Gateway',
        local_enabled: false,
        created_at_ms: 10,
        updated_at_ms: 20,
      }],
    });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual(snapshot);
  });

  it('rejects v1 schema drift without changing the file', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const original = `${JSON.stringify({
      schema_version: 1,
      gateways: [{
        schema_version: 1,
        gateway_id: 'gw_drift',
        display_name: 'Drifted Gateway',
        local_enabled: true,
        connection: { kind: 'local_host', runtime_root: '/tmp/redeven' },
        created_at_ms: 10,
        updated_at_ms: 20,
      }],
    }, null, 2)}\n`;
    await fs.writeFile(filePath, original, 'utf8');

    await expect(new GatewayStore(filePath).load()).rejects.toMatchObject({
      code: 'GATEWAY_STORE_SCHEMA_DRIFT',
    });
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });

  it('rejects future schemas without changing the file', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const original = '{"schema_version":3,"gateways":[]}\n';
    await fs.writeFile(filePath, original, 'utf8');

    await expect(new GatewayStore(filePath).load()).rejects.toMatchObject({
      code: 'GATEWAY_STORE_FUTURE_SCHEMA',
    });
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });

  it('leaves v1 bytes intact when the v2 migration cannot commit', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const original = '{"schema_version":1,"gateways":[]}\n';
    await fs.writeFile(filePath, original, 'utf8');
    const store = new GatewayStore(filePath, async () => {
      throw new Error('injected persistence failure');
    });

    await expect(store.load()).rejects.toThrow('injected persistence failure');
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });

  it('keeps the last committed snapshot when a v2 mutation cannot persist', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultGatewayStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const original = `${JSON.stringify({
      schema_version: 2,
      gateways: [{
        schema_version: 2,
        gateway_id: 'gw_committed',
        display_name: 'Committed Gateway',
        local_enabled: true,
        connection: { kind: 'url', base_url: 'https://gateway.example/', allow_loopback_http: false },
        created_at_ms: 10,
        updated_at_ms: 20,
      }],
    }, null, 2)}\n`;
    await fs.writeFile(filePath, original, 'utf8');
    const store = new GatewayStore(filePath, async () => {
      throw new Error('injected persistence failure');
    });
    await store.load();

    await expect(store.setLocalEnabled('gw_committed', false, 30)).rejects.toThrow('injected persistence failure');
    expect((await store.get('gw_committed'))?.local_enabled).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });

  it('normalizes duplicate records and projects source rows without env secrets', () => {
    const snapshot = normalizeGatewayStoreSnapshot({
      gateways: [
        { gateway_id: 'gw_demo', display_name: 'B', connection: { kind: 'url', base_url: 'https://b.example/' } },
        { gateway_id: 'gw_demo', display_name: 'A', connection: { kind: 'url', base_url: 'https://a.example/' } },
      ],
    }, 1);

    expect(snapshot.gateways).toHaveLength(1);
    expect(snapshot.gateways[0]?.display_name).toBe('A');
    const source = gatewayRecordToSource(snapshot.gateways[0] as GatewayRecord);
    expect(source).toMatchObject({
      gateway_id: 'gw_demo',
      management_capability: 'access_only',
      status: 'pairing_required',
      trust_state: 'unpaired',
      service_state: {
        status: 'not_applicable',
        can_start: false,
        can_stop: false,
        can_restart: false,
        can_update: false,
        can_pair_after_start: false,
      },
      environments: [],
    });
    expect(JSON.stringify(source)).not.toContain('paired_client_private_key_ref');
  });

  it('defaults Gateway records to locally enabled and preserves the local toggle across edits', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    const created = await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: { kind: 'url', base_url: 'https://gateway.example/' },
      now_ms: 10,
    });
    expect(created.local_enabled).toBe(true);
    expect(gatewayRecordToSource(created).local_enabled).toBe(true);

    const disabled = await store.setLocalEnabled('gw_demo', false);
    expect(disabled.local_enabled).toBe(false);
    expect(gatewayRecordToSource(disabled).local_enabled).toBe(false);

    const edited = await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Renamed Gateway',
      connection: { kind: 'url', base_url: 'https://gateway.example/' },
      now_ms: 20,
    });
    expect(edited.local_enabled).toBe(false);

    const reloaded = await new GatewayStore(defaultGatewayStorePath(root)).get('gw_demo');
    expect(reloaded?.local_enabled).toBe(false);
  });

  it('rejects unsafe Gateway ids before they can be used as managed service roots', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    await expect(store.upsert({
      gateway_id: '../gw demo',
      display_name: 'Unsafe Gateway',
      connection: { kind: 'url', base_url: 'https://gateway.example/' },
    })).rejects.toMatchObject({
      code: 'GATEWAY_ID_REQUIRED',
    });

    expect(normalizeGatewayStoreSnapshot({
      gateways: [{ gateway_id: '../gw demo', connection: { kind: 'url', base_url: 'https://gateway.example/' } }],
    }).gateways).toHaveLength(0);
  });

  it('rejects embedded credentials and strips URL query strings from Gateway base URLs', () => {
    expect(normalizeGatewayBaseURL('https://gateway.example/path?token=leak#frag')).toBe('https://gateway.example/path/');
    expect(() => normalizeGatewayBaseURL('https://user:pass@gateway.example/')).toThrow('embedded credentials');
  });

  it('builds transport-bound audiences for trust pinning', () => {
    expect(gatewayBindingAudience({ kind: 'url', base_url: 'https://gateway.example/' })).toBe('https://gateway.example/');
    expect(gatewayBindingAudience({
      kind: 'ssh_host',
      ssh_destination: 'bastion',
      ssh_port: 2222,
      username: 'dev',
      runtime_root: '/opt/redeven',
    })).toBe('ssh://dev@bastion:2222/opt/redeven');
    expect(stableGatewayID('https://gateway.example/')).toMatch(/^gw_[A-Za-z0-9_-]{24}$/u);
  });

  it('projects SSH Gateway details without leaking password secret refs', () => {
    const record = normalizeGatewayStoreSnapshot({
      gateways: [{
        gateway_id: 'gw_ssh',
        display_name: 'SSH Gateway',
        connection: {
          kind: 'ssh_host',
          ssh_destination: 'bastion',
          ssh_port: 2222,
          auth_mode: 'password',
          ssh_password_configured: true,
          ssh_password_ref: 'gateway-ssh-password:gw_ssh',
          runtime_root: 'remote_default',
          bootstrap_strategy: 'auto',
        },
      }],
    }, 1).gateways[0] as GatewayRecord;

    expect(record.connection).toMatchObject({
      auth_mode: 'password',
      ssh_password_configured: true,
      ssh_password_ref: 'gateway-ssh-password:gw_ssh',
    });
    const source = gatewayRecordToSource(record);
    expect(source).toMatchObject({
      connection_kind: 'ssh_host',
      management_capability: 'managed_ssh_host',
      ssh_details: expect.objectContaining({
        ssh_destination: 'bastion',
        ssh_port: 2222,
        auth_mode: 'password',
        runtime_root: 'remote_default',
      }),
      ssh_password_configured: true,
    });
    expect(source.service_state).toBeUndefined();
    expect(JSON.stringify(source)).not.toContain('gateway-ssh-password');
  });

  it('projects SSH container Gateway management capability without persisting runtime state', () => {
    const record = normalizeGatewayStoreSnapshot({
      gateways: [{
        gateway_id: 'gw_container',
        display_name: 'Container Gateway',
        connection: {
          kind: 'ssh_container',
          ssh_destination: 'bastion',
          container_engine: 'docker',
          container_id: 'container-stable-id',
          container_ref: 'dev',
          container_label: 'Dev',
          runtime_root: 'remote_default',
        },
      }],
    }, 1).gateways[0] as GatewayRecord;

    const source = gatewayRecordToSource(record);
    expect(source).toMatchObject({
      connection_kind: 'ssh_container',
      management_capability: 'managed_ssh_container',
      container_engine: 'docker',
      container_id: 'container-stable-id',
      container_ref: 'dev',
      container_label: 'Dev',
    });
    expect(source.service_state).toBeUndefined();
  });

  it('normalizes managed local host and container Gateway records', () => {
    const snapshot = normalizeGatewayStoreSnapshot({
      gateways: [{
        gateway_id: 'gw_local',
        display_name: 'Local Gateway',
        connection: { kind: 'local_host', runtime_root: '/tmp/redeven' },
      }, {
        gateway_id: 'gw_local_container',
        display_name: 'Local Container Gateway',
        connection: {
          kind: 'local_container',
          container_engine: 'podman',
          container_id: 'dev-id',
          container_ref: 'dev',
          container_label: 'Dev',
          runtime_root: '/workspace/.redeven',
        },
      }],
    }, 1);

    expect(snapshot.gateways.map(gatewayRecordToSource)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connection_kind: 'local_host',
        management_capability: 'managed_local_host',
        endpoint_label: 'This device',
        runtime_root: '/tmp/redeven',
      }),
      expect.objectContaining({
        connection_kind: 'local_container',
        management_capability: 'managed_local_container',
        container_engine: 'podman',
        container_id: 'dev-id',
        runtime_root: '/workspace/.redeven',
      }),
    ]));
    expect(gatewayBindingAudience(snapshot.gateways[0]!.connection)).toMatch(/^local(?:-container)?:\/\//u);
  });

  it('drops stale trust profiles when the Gateway connection identity changes', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://old.example/',
      },
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: 'gck_demo',
        paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
        gateway_id: 'gw_demo',
        gateway_public_key: 'PUBLIC KEY',
        gateway_public_key_fingerprint: 'SHA256:fingerprint',
        binding_audience: 'https://old.example/',
        created_at_unix_ms: 1,
      },
      now_ms: 1,
    });

    const updated = await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://new.example/',
      },
      now_ms: 2,
    });

    expect(updated.connection).toMatchObject({ base_url: 'https://new.example/' });
    expect(updated.trust_profile).toBeUndefined();
    expect(updated.last_catalog_sync_at_ms).toBeUndefined();
    expect(gatewayRecordToSource(updated)).toMatchObject({
      trust_state: 'unpaired',
      status: 'pairing_required',
    });
  });

  it('persists the latest catalog sync timestamp without changing trust or connection settings', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://gateway.example/',
      },
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: 'gck_demo',
        paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
        gateway_id: 'gw_demo',
        gateway_public_key: 'PUBLIC KEY',
        gateway_public_key_fingerprint: 'SHA256:fingerprint',
        binding_audience: 'https://gateway.example/',
        created_at_unix_ms: 1,
      },
      now_ms: 10,
    });

    const marked = await store.markCatalogSynced('gw_demo', 20);
    expect(marked).toMatchObject({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: { kind: 'url', base_url: 'https://gateway.example/' },
      last_catalog_sync_at_ms: 20,
      updated_at_ms: 20,
      trust_profile: expect.objectContaining({
        trust_profile_id: 'gtp_demo',
      }),
    });

    const loaded = await new GatewayStore(defaultGatewayStorePath(root)).get('gw_demo');
    expect(loaded?.last_catalog_sync_at_ms).toBe(20);
    expect(loaded?.trust_profile?.trust_profile_id).toBe('gtp_demo');
  });

  it('serializes local enable toggles with trust and catalog mutations', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const store = new GatewayStore(defaultGatewayStorePath(root));

    await store.upsert({
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: { kind: 'url', base_url: 'https://gateway.example/' },
      now_ms: 10,
    });

    await Promise.all([
      store.setLocalEnabled('gw_demo', false, 20),
      store.updateTrustProfile('gw_demo', {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: 'gck_demo',
        paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
        gateway_id: 'gw_demo',
        gateway_public_key: 'PUBLIC KEY',
        gateway_public_key_fingerprint: 'SHA256:fingerprint',
        binding_audience: 'https://gateway.example/',
        created_at_unix_ms: 30,
      }),
      store.markCatalogSynced('gw_demo', 40),
    ]);

    const loaded = await new GatewayStore(defaultGatewayStorePath(root)).get('gw_demo');
    expect(loaded).toMatchObject({
      gateway_id: 'gw_demo',
      local_enabled: false,
      last_catalog_sync_at_ms: 40,
      trust_profile: expect.objectContaining({
        trust_profile_id: 'gtp_demo',
      }),
    });
  });

  it('projects paired catalog rows without leaking trust material', () => {
    const record = normalizeGatewayStoreSnapshot({
      gateways: [{
        gateway_id: 'gw_demo',
        display_name: 'Stored Gateway',
        connection: { kind: 'url', base_url: 'https://gateway.example/' },
        trust_profile: {
          trust_profile_id: 'gtp_demo',
          paired_client_key_id: 'gck_demo',
          paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
          gateway_id: 'gw_demo',
          gateway_public_key: 'PUBLIC KEY',
          gateway_public_key_fingerprint: 'SHA256:fingerprint',
          binding_audience: 'https://gateway.example/',
          created_at_unix_ms: 1,
        },
      }],
    }, 1).gateways[0] as GatewayRecord;

    const source = gatewayRecordToSourceWithCatalog(record, {
      status: 'online',
      environments: [{
        gateway_env_id: 'env_demo',
        display_name: 'Demo Env',
        env_kind: 'reachable_env',
        state: 'available',
        capabilities: ['open'],
        origin: { kind: 'network_target', label: '10.0.0.10' },
      }],
    });

    expect(source).toMatchObject({
      display_name: 'Stored Gateway',
      status: 'online',
      environments: [expect.objectContaining({ gateway_env_id: 'env_demo' })],
    });
    expect(JSON.stringify(source)).not.toContain('paired_client_private_key_ref');
    expect(gatewayRecordToSourceWithError(record, 'token proof signature private_key')).toMatchObject({
      status: 'error',
      status_message: '[redacted] [redacted] [redacted] [redacted]',
      environments: [],
    });
    expect(gatewayRecordToSourceWithError(record, 'Gateway identity changed and must be paired again.', 'GATEWAY_TRUST_CHANGED')).toMatchObject({
      status: 'trust_changed',
      trust_state: 'trust_changed',
      status_message: 'Gateway identity changed and must be paired again.',
      environments: [],
    });
  });
});
