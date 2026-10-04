import { gatewayProtocolID, type GatewayRecord } from './gatewayStore';
import { createGatewayPairingMaterial, gatewayPublicKeyFingerprint } from './gatewayTrust';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';
import { describe, expect, it, vi } from 'vitest';

import { GatewayBridgeClient, normalizeGatewayCatalogResponse, normalizeGatewayOpenSessionResponse, redactGatewayDiagnosticValue } from './gatewayClient';

describe('Gateway access client contracts', () => {
  it('rejects invalid or missing v3 profile access modes instead of selecting a route', () => {
    for (const mode of [undefined, '', 'automatic', false]) {
      expect(() => normalizeGatewayCatalogResponse({
        protocol_version: 'redeven-gateway-v3', gateway: { gateway_id: 'gw-1' },
        environments: [{ gateway_env_id: 'env-1', profile: { managed: true, access_route_kind: 'url', access_mode: mode } }],
      })).toThrow('Gateway profile access_mode is invalid.');
    }
  });
  it('normalizes an access-only catalog environment', () => {
    const catalog = normalizeGatewayCatalogResponse({
      protocol_version: 'redeven-gateway-v3',
      gateway: {
        gateway_id: 'gw-1',
        display_name: 'Gateway',
        status: 'online',
        capabilities: ['env_catalog', 'env_direct_open', 'env_proxy_open'],
      },
      environments: [{
        gateway_env_id: 'env-1',
        display_name: 'Remote',
        env_kind: 'managed_local_env',
        state: 'available',
        capabilities: ['open', 'start'],
        control_capabilities: ['start'],
        origin: { kind: 'gateway_host', label: 'host' },
      }],
    });
    expect(catalog.environments[0]).toMatchObject({
      env_kind: 'reachable_env',
      capabilities: [],
    });
  });

  it('validates open-session response shape', () => {
    const response = normalizeGatewayOpenSessionResponse({
      protocol_version: 'redeven-gateway-v3',
      gateway_session_id: 'session',
      gateway_env_id: 'env-1',
      connect_artifact: {
        kind: 'local_direct_artifact',
        url: 'http://127.0.0.1:24000/',
        expires_at_unix_ms: Date.now() + 60_000,
        artifact_nonce: 'nonce',
        proof: 'proof',
      },
    });
    expect(response.gateway_env_id).toBe('env-1');
  });

  it('redacts Gateway secrets from diagnostics', () => {
    expect(redactGatewayDiagnosticValue({ token: 'secret', nested: { proof: 'x' }, value: 'ok' })).toEqual({
      token: '[redacted]',
      nested: { proof: '[redacted]' },
      value: 'ok',
    });
  });
});

// Non-ASCII fixture text verifies byte framing independently from UI localization.
describe('Gateway bridge HTTP byte framing', () => {
  it.each(['content-length', 'chunked'] as const)('rejects incomplete %s responses even when the received JSON is valid', async framing => {
    const body = Buffer.from('{"ok":true,"data":{}}');
    const bytes = Buffer.from(framing === 'content-length'
      ? `HTTP/1.1 200 OK\r\nContent-Length: ${body.length + 1}\r\n\r\n${body}`
      : `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n`);
    let receive!: (chunk: Buffer) => void | Promise<void>;
    let end!: () => void;
    let sent = false;
    const close = vi.fn(async () => {});
    const bridge: RuntimePlacementBridgeSessionHandle = { openStream: () => ({ id: 'truncated',
      onData: callback => { receive = callback; }, onClose: callback => { end = callback; }, onError: () => {}, close,
      write: async () => {
        if (sent) return;
        sent = true;
        setImmediate(() => { void Promise.resolve(receive(bytes)).then(end); });
      }, closeWrite: async () => {},
    }) };
    const record: GatewayRecord = { schema_version: 3, gateway_id: 'gw', display_name: 'Gateway', local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/gateway-test' }, created_at_ms: 1, updated_at_ms: 1 };
    const client = new GatewayBridgeClient({ readSecret: () => '', writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    await expect(client.pairingChallenge(record, { protocol_version: 'redeven-gateway-v3', client_nonce: 'test', client_public_key: 'test', binding_audience: 'test' }))
      .rejects.toMatchObject({ code: 'GATEWAY_BRIDGE_FAILED' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'timeout', 'unavailable'] as const)('releases only its own stream after %s', async mode => {
    const controller = new AbortController();
    const close = vi.fn(async () => {});
    const bridge: RuntimePlacementBridgeSessionHandle = { openStream: () => {
      if (mode === 'unavailable') throw new Error('fixture bridge unavailable');
      return { id: 'pending', onData: () => {}, onClose: () => {}, onError: () => {}, close,
        write: async () => { if (mode === 'cancel') controller.abort(); } };
    } };
    const record: GatewayRecord = { schema_version: 3, gateway_id: 'gw', display_name: 'Gateway', local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/gateway-test' }, created_at_ms: 1, updated_at_ms: 1 };
    const client = new GatewayBridgeClient({ readSecret: () => '', writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    await expect(client.pairingChallenge(record, { protocol_version: 'redeven-gateway-v3', client_nonce: 'test', client_public_key: 'test', binding_audience: 'test' },
      { signal: controller.signal, timeoutMs: 10 })).rejects.toMatchObject({
        code: mode === 'cancel' ? 'GATEWAY_CANCELED' : mode === 'timeout' ? 'GATEWAY_TIMEOUT' : 'GATEWAY_BRIDGE_UNAVAILABLE',
      });
    expect(close).toHaveBeenCalledTimes(mode === 'unavailable' ? 0 : 1);
  });

  it.each(['split-utf8', 'chunked', 'chunked-reset'] as const)('preserves Unicode catalogs over %s responses', async framing => {
    const base: GatewayRecord = { schema_version: 3, gateway_id: 'gw_unicode', display_name: 'Gateway', local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/gateway-test' }, created_at_ms: 1, updated_at_ms: 1 };
    const material = createGatewayPairingMaterial(base);
    const fingerprint = gatewayPublicKeyFingerprint(material.client_public_key);
    const record: GatewayRecord = { ...base, trust_profile: {
      trust_profile_id: 'trust', gateway_id: base.gateway_id, paired_client_key_id: material.client_key_id,
      paired_client_private_key_ref: material.private_key_ref, gateway_public_key: material.client_public_key,
      gateway_public_key_fingerprint: fingerprint, binding_audience: material.binding_audience,
      created_at_unix_ms: 1, last_verified_at_unix_ms: 1,
    } };
    const displayName = '中文环境 café 🚀';
    const body = Buffer.from(JSON.stringify({ ok: true, data: { protocol_version: 'redeven-gateway-v3',
      gateway: { gateway_id: gatewayProtocolID(base), gateway_public_key_fingerprint: fingerprint, display_name: displayName }, environments: [] } }));
    const split = body.indexOf(Buffer.from('中文')) + 1;
    const chunks = framing === 'split-utf8'
      ? [Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`), body.subarray(0, split), body.subarray(split)]
      : [Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
        ...[body.subarray(0, split), body.subarray(split)].flatMap(chunk => [Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from('\r\n')]),
        Buffer.from('0\r\nX-Fixture: complete\r\n\r\n')];
    let data!: (chunk: Buffer) => void | Promise<void>;
    let close!: () => void;
    let fail!: (error: Error) => void;
    let sent = false;
    const bridge: RuntimePlacementBridgeSessionHandle = { openStream: () => ({ id: 'fixture',
      onData: callback => { data = callback; }, onClose: callback => { close = callback; }, onError: callback => { fail = callback; },
      write: async () => {
        if (sent) return;
        sent = true;
        setImmediate(() => { void (async () => {
          for (const chunk of chunks) await data(chunk);
          if (framing === 'chunked-reset') fail(new Error('bridge closed after complete response'));
          else close();
        })(); });
      }, closeWrite: async () => {}, close: async () => {},
    }) };
    const client = new GatewayBridgeClient({ readSecret: () => material.client_private_key, writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    const response = await client.catalog(record);
    expect(response.gateway.display_name).toBe(displayName);
  });
});
