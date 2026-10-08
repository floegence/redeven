import { catalogFixture } from '../testSupport/gatewayMembershipFixture';
import { type GatewayRecord } from './gatewayStore';
import { createGatewayPairingMaterial, gatewayPublicKeyFingerprint } from './gatewayTrust';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';
import { describe, expect, it, vi } from 'vitest';

import { GatewayClient, normalizeGatewayCatalogResponse, redactGatewayDiagnosticValue } from './gatewayClient';

describe('Gateway access client contracts', () => {
  it('rejects URL management before signing or network delivery', async () => {
    const record: GatewayRecord = { schema_version: 4, gateway_id: 'consumer', display_name: 'URL client', local_enabled: true, connection: { kind: 'url', base_url: 'https://gateway.example/' }, created_at_ms: 1, updated_at_ms: 1 };
    const secretStore = { readSecret: vi.fn(), writeSecret: vi.fn(), deleteSecret: vi.fn() };
    const client = new GatewayClient(secretStore);
    for (const action of [() => client.issueAccessCode(record), () => client.listClients(record), () => client.revokeClient(record, 'other')]) {
      await expect(action()).rejects.toMatchObject({ code: 'HOST_MANAGEMENT_REQUIRED' });
    }
    expect(secretStore.readSecret).not.toHaveBeenCalled();
  });

  it('rejects old protocols, duplicate members and malformed policies', () => {
    expect(() => normalizeGatewayCatalogResponse({ ...catalogFixture, protocol_version: 'redeven-gateway-v3' })).toThrow();
    expect(() => normalizeGatewayCatalogResponse({ ...catalogFixture, members: [...catalogFixture.members, ...catalogFixture.members] })).toThrow();
    expect(() => normalizeGatewayCatalogResponse({ ...catalogFixture, policy: { ...catalogFixture.policy, default_cloud_allowed: 'yes' } })).toThrow();
  });
  it('preserves explicit permissions and separate member connection and Cloud states', () => {
    expect(normalizeGatewayCatalogResponse(catalogFixture)).toEqual(catalogFixture);
  });

  it('requires the canonical signed member origin from Gateway', () => {
    const catalog = (address: string) => ({ ...catalogFixture, gateway: { ...catalogFixture.gateway, member_endpoints: [{ ...catalogFixture.gateway.member_endpoints[0], address }] } });
    expect(normalizeGatewayCatalogResponse(catalog('https://macbook-pro.local:7443')).gateway.member_endpoints[0].address).toBe('https://macbook-pro.local:7443');
    expect(normalizeGatewayCatalogResponse(catalog('https://gateway.example')).gateway.member_endpoints[0].address).toBe('https://gateway.example');
    for (const url of ['https://MacBook-Pro.local:7443', 'https://gateway.example:443', 'https://gateway.example/path', 'https://gateway.example/?redirect=1', 'https://gateway.example/#member', 'https://user:secret@gateway.example']) {
      expect(() => normalizeGatewayCatalogResponse(catalog(url))).toThrow();
    }
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
    const record: GatewayRecord = { schema_version: 4, gateway_id: 'gw', display_name: 'Gateway', local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/gateway-test' }, created_at_ms: 1, updated_at_ms: 1 };
    const client = new GatewayClient({ readSecret: () => '', writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    await expect(client.pairingChallenge(record, { protocol_version: 'redeven-gateway-v5', client_nonce: 'test', client_public_key: 'test', binding_audience: 'test' }))
      .rejects.toMatchObject({ code: 'GATEWAY_UNREACHABLE' });
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
    const record: GatewayRecord = { schema_version: 4, gateway_id: 'gw', display_name: 'Gateway', local_enabled: true,
      connection: { kind: 'local_host', runtime_root: '/tmp/gateway-test' }, created_at_ms: 1, updated_at_ms: 1 };
    const client = new GatewayClient({ readSecret: () => '', writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    await expect(client.pairingChallenge(record, { protocol_version: 'redeven-gateway-v5', client_nonce: 'test', client_public_key: 'test', binding_audience: 'test' },
      { signal: controller.signal, timeoutMs: 10 })).rejects.toMatchObject({
        code: mode === 'cancel' ? 'GATEWAY_CANCELED' : mode === 'timeout' ? 'GATEWAY_CANCELED' : 'GATEWAY_UNREACHABLE',
      });
    expect(close).toHaveBeenCalledTimes(mode === 'unavailable' ? 0 : 1);
  });

  it.each(['split-utf8', 'chunked', 'chunked-reset'] as const)('preserves Unicode catalogs over %s responses', async framing => {
    const base: GatewayRecord = { schema_version: 4, gateway_id: 'gw_unicode', display_name: 'Gateway', local_enabled: true,
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
    const body = Buffer.from(JSON.stringify({ ok: true, data: { protocol_version: 'redeven-gateway-v5',
      gateway: { ...catalogFixture.gateway, gateway_id: base.gateway_id, gateway_public_key_fingerprint: fingerprint, display_name: displayName }, members: [], policy: catalogFixture.policy, revision: 1, rebuild_required: false, hook_status: catalogFixture.hook_status } }));
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
    const client = new GatewayClient({ readSecret: () => material.client_private_key, writeSecret: () => {}, deleteSecret: () => {} }, bridge);
    const response = await client.catalog(record);
    expect(response.gateway.display_name).toBe(displayName);
  });
});
