import { describe, expect, it } from 'vitest';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { savedGatewaySuggestions } from './savedGatewaySuggestions';

const gateway: DesktopGatewaySource = {
  gateway_id: 'saved', display_name: 'Office Gateway', local_enabled: true, connection_kind: 'url',
  management_capability: 'access_only', capabilities: [], status: 'unknown',
  created_at_ms: 1, updated_at_ms: 1, environments: [], gateway_url: 'https://office.example:7443/',
};
const endpoint = (address: string, priority = 0) => ({ endpoint_id: address, address, priority, scope: 'public' as const });

describe('saved Gateway addresses', () => {
  it('uses a saved HTTPS origin before catalog sync without requiring Desktop pairing', () => {
    expect(savedGatewaySuggestions([gateway], 'ssh:runtime')).toEqual([
      { gatewayID: 'saved', name: 'Office Gateway', address: 'https://office.example:7443' },
    ]);
  });
  it('prefers advertised endpoints, respects priority and deduplicates addresses across records', () => {
    const source = { ...gateway, member_endpoints: [endpoint('https://second.example', 2), endpoint('https://first.example', 1)] };
    expect(savedGatewaySuggestions([source, { ...source, gateway_id: 'duplicate' }], 'ssh:runtime').map(item => item.address))
      .toEqual(['https://first.example', 'https://second.example']);
  });
  it.each(['offline', 'unknown', 'starting', 'error'] as const)('retains known endpoints while the observed status is %s', status => {
    expect(savedGatewaySuggestions([{ ...gateway, status, listener_running: false }], 'ssh:runtime')).toHaveLength(1);
  });
  it.each(['http://office.example/', 'https://office.example/path/', 'https://user:secret@office.example/',
    'https://office.example/?secret=value', 'https://office.example/#fragment', 'https://0.0.0.0:7443/',
    'https://[::]:7443/', 'not an address'])('rejects an unusable saved URL %s', gateway_url => {
    expect(savedGatewaySuggestions([{ ...gateway, gateway_url }], 'ssh:runtime')).toEqual([]);
  });
  it.each(['https://localhost:7443', 'https://gateway.localhost:7443', 'https://127.0.0.1:7443', 'https://[::1]:7443'])(
    'restricts loopback address %s to a local Runtime', address => {
      const source = { ...gateway, member_endpoints: [endpoint(address)] };
      expect(savedGatewaySuggestions([source], 'ssh:runtime')).toEqual([]);
      expect(savedGatewaySuggestions([source], 'local:local')).toHaveLength(1);
    });
  it('does not bypass advertised Host restrictions using the saved URL', () => {
    expect(savedGatewaySuggestions([{ ...gateway, allowed_hosts: ['office.example'],
      member_endpoints: [endpoint('https://rejected.example')] }], 'ssh:runtime')).toEqual([]);
  });
  it.each(['revoked', 'trust_changed'] as const)('excludes explicitly rejected trust state %s', trust_state => {
    expect(savedGatewaySuggestions([{ ...gateway, trust_state }], 'ssh:runtime')).toEqual([]);
  });
  it('does not infer enrollment addresses from management or wildcard listener coordinates', () => {
    expect(savedGatewaySuggestions([{ ...gateway, connection_kind: 'ssh_host', gateway_url: undefined,
      endpoint_label: 'operator@office.example:22', listener_address: '0.0.0.0:7443',
      listener_addresses: [':7443'], active_listener_addresses: ['[::]:7443'] }], 'ssh:runtime')).toEqual([]);
  });
});
