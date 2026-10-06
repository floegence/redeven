import { describe, expect, it } from 'vitest';
import { normalizeGatewayCloudConfiguration, parseGatewayCloudSummary } from './gatewayCloud';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

describe('Gateway Cloud trust boundary', () => {
  const configuration = { cloud_origin: 'https://cloud.example', gateway_url: 'https://gateway.internal:7443', egress_listen: '0.0.0.0:7443' };
  it('normalizes explicit HTTPS origins and rejects shell syntax and invalid ports before host execution', () => {
    expect(normalizeGatewayCloudConfiguration(configuration)).toEqual(configuration);
    for (const invalid of ['http://gateway.internal', 'https://user:pass@gateway.internal', 'https://gateway.internal/path', 'https://gateway.internal#fragment']) {
      expect(normalizeGatewayCloudConfiguration({ ...configuration, gateway_url: invalid })).toBeNull();
    }
    for (const invalid of ['0.0.0.0:0', '0.0.0.0:65536', '0.0.0.0:7443;touch /tmp/unwanted', '$(id):7443']) {
      expect(normalizeGatewayCloudConfiguration({ ...configuration, egress_listen: invalid })).toBeNull();
    }
    expect(normalizeDesktopLauncherActionRequest({ kind: 'configure_gateway_cloud', gateway_id: 'gateway-1', configuration })).toEqual({ kind: 'configure_gateway_cloud', gateway_id: 'gateway-1', configuration });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'configure_gateway_cloud', gateway_id: 'gateway-1', configuration: { ...configuration, cloud_origin: 'file:///tmp' } })).toBeNull();
  });
  it('only returns safe identity fields and same-origin Cloud links', () => {
    const summary = { configured: true, state: 'active', cloud_origin: 'https://cloud.example', gateway_public_id: 'gateway-1', namespace_public_id: 'namespace-1', region: 'sg', management_url: 'https://cloud.example/namespaces/namespace-1/gateways', private_key: 'must-not-reach-renderer' };
    const result = parseGatewayCloudSummary(JSON.stringify(summary));
    expect(result).not.toHaveProperty('private_key');
    expect(result.namespace_public_id).toBe('namespace-1');
    for (const management_url of ['https://phishing.example', 'https://user:password@cloud.example', 'javascript:alert(1)']) {
      expect(() => parseGatewayCloudSummary(JSON.stringify({ ...summary, management_url }))).toThrow();
    }
    expect(() => parseGatewayCloudSummary(JSON.stringify({ ...summary, namespace_public_id: '' }))).toThrow();
    expect(() => parseGatewayCloudSummary('null')).toThrow();
  });
});
