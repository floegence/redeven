import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GatewayStore,
  defaultGatewayStorePath,
  gatewayBindingAudience,
  gatewayRecordToSource,
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
      status: 'pairing_required',
      trust_state: 'unpaired',
      environments: [],
    });
    expect(JSON.stringify(source)).not.toContain('paired_client_private_key_ref');
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
    expect(gatewayRecordToSource(updated)).toMatchObject({
      trust_state: 'unpaired',
      status: 'pairing_required',
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
      display_name: 'Live Gateway',
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
      display_name: 'Live Gateway',
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
