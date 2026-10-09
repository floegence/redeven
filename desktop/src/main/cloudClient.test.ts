import { describe, expect, it, vi } from 'vitest';

import { type DesktopProviderTransport, type DesktopProviderTransportResponse } from './cloudTransport';
import { fetchProviderDiscovery } from './cloudClient';

const response = (body: unknown): DesktopProviderTransportResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body_text: JSON.stringify(body),
});

describe('cloudClient', () => {
  it('fetches Provider discovery without Runtime management capabilities', async () => {
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValue(response({
      protocol_version: 'rcpp-v4',
      cloud_id: 'provider-1',
      display_name: 'Provider',
      cloud_origin: 'https://provider.test',
      documentation_url: 'https://provider.test/help',
      access_points: [{
        access_point_id: 'default',
        region: 'default',
        display_name: 'Default',
        description: 'Default access point',
        access_point_origin: 'https://provider.test',
        country_code: 'US',
        city: 'Test',
        status: 'active',
        health_status: 'healthy',
      }],
    }));
    const provider = await fetchProviderDiscovery('https://provider.test', { transport });
    expect(provider?.cloud_id).toBe('provider-1');
    expect(JSON.stringify(provider)).not.toContain('runtime_management');
  });
});
