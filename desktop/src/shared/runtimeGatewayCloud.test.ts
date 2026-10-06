import { describe, expect, it } from 'vitest';
import { normalizeRuntimeGatewayCloud, runtimeGatewayManagementURL } from './runtimeGatewayCloud';

describe('Runtime Gateway Cloud presentation', () => {
  const access = { protocol_version: 1, cloud_origin: 'https://cloud.example', namespace_public_id: 'ns_1', gateway_public_id: 'gw_1', state: 'connected' };
  it('retains only non-sensitive fields and derives a same-origin management URL', () => {
    const normalized = normalizeRuntimeGatewayCloud({ ...access, private_key: 'secret', management_url: 'https://phishing.example' });
    expect(normalized).toEqual(access);
    expect(runtimeGatewayManagementURL(normalized!)).toBe('https://cloud.example/namespaces/ns_1/gateways?gateway=gw_1');
  });
  it('rejects unknown contracts, malformed IDs and credential-bearing origins', () => {
    for (const change of [{ protocol_version: 2 }, { state: 'ready' }, { gateway_public_id: '../admin' }, { namespace_public_id: '' }, { cloud_origin: 'https://user:secret@cloud.example' }, { cloud_origin: 'http://cloud.example' }]) {
      expect(normalizeRuntimeGatewayCloud({ ...access, ...change })).toBeUndefined();
    }
  });
});
