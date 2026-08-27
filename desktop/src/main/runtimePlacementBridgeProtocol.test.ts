import { describe, expect, it } from 'vitest';

import {
  parseRuntimePlacementBridgeHello,
  RUNTIME_PLACEMENT_BRIDGE_MAX_CONCURRENT_STREAMS,
  RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
  RUNTIME_PLACEMENT_BRIDGE_SESSION_WINDOW_BYTES,
  RUNTIME_PLACEMENT_BRIDGE_STREAM_WINDOW_BYTES,
  runtimeControlEndpointFromBridgeHello,
  runtimePlacementBridgeStreamError,
  runtimePlacementBridgeSurfaceAuthority,
} from './runtimePlacementBridgeProtocol';

const validHello = {
  protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
  runtime_version: 'v0.12.0',
  started_at_unix_ms: 1778751234567,
  local_ui: {
    available: true,
    base_path: '/',
    bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  runtime_control: {
    available: true,
    protocol_version: 'redeven-runtime-control-v2',
    base_url: 'http://127.0.0.1:10001/',
    token: 'runtime-token',
  },
};

describe('runtimePlacementBridgeProtocol', () => {
  it('keeps the private HTTP/2 protocol and resource limits exact', () => {
    expect(RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION).toBe('redeven-desktop-placement-h2/1');
    expect(RUNTIME_PLACEMENT_BRIDGE_MAX_CONCURRENT_STREAMS).toBe(64);
    expect(RUNTIME_PLACEMENT_BRIDGE_STREAM_WINDOW_BYTES).toBe(256 * 1024);
    expect(RUNTIME_PLACEMENT_BRIDGE_SESSION_WINDOW_BYTES).toBe(16 * 1024 * 1024);
  });

  it('maps each internal surface to one HTTP/2 CONNECT authority', () => {
    expect(runtimePlacementBridgeSurfaceAuthority('local_ui')).toBe('local-ui');
    expect(runtimePlacementBridgeSurfaceAuthority('runtime_control')).toBe('runtime-control');
    expect(runtimePlacementBridgeSurfaceAuthority('gateway_protocol')).toBe('gateway-protocol');
  });

  it('parses hello and maps runtime control through the local proxy', () => {
    const hello = parseRuntimePlacementBridgeHello(Buffer.from(JSON.stringify(validHello)));
    expect(hello).toMatchObject(validHello);
    expect(runtimeControlEndpointFromBridgeHello(hello, 'http://127.0.0.1:43210/')).toEqual({
      protocol_version: 'redeven-runtime-control-v2',
      base_url: 'http://127.0.0.1:43210/__redeven_runtime_control/',
      token: 'runtime-token',
    });
  });

  it('rejects an old bridge instead of negotiating or falling back', () => {
    expect(() => parseRuntimePlacementBridgeHello(Buffer.from(JSON.stringify({
      ...validHello,
      protocol_version: 'redeven-desktop-bridge-v1',
    })))).toThrow('Unsupported Runtime Placement Bridge protocol version');
  });

  it('rejects Local UI without private authorization', () => {
    expect(() => parseRuntimePlacementBridgeHello(Buffer.from(JSON.stringify({
      ...validHello,
      local_ui: { available: true, base_path: '/' },
    })))).toThrow('private Local UI authorization');
  });

  it('returns bounded stable stream errors without remote details', () => {
    expect(runtimePlacementBridgeStreamError('SURFACE_DIAL_FAILED')).toEqual({
      code: 'SURFACE_DIAL_FAILED',
      message: 'Runtime Placement Bridge stream failed (SURFACE_DIAL_FAILED).',
    });
  });
});
