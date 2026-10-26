import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { gatewayConnectionOrigin } from '../shared/gatewayNetworkSettings';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

/** A usable address is only an input to verification, never evidence of reachability. */
export function gatewayRuntimeAddress(address: string, gateway: DesktopGatewaySource, target: DesktopCloudRuntimeLinkTargetID): string | null {
  const origin = gatewayConnectionOrigin(address);
  if (!origin) return null;
  const host = new URL(origin).hostname;
  const allowedHost = host.replace(/^\[|\]$/gu, '').toLowerCase();
  if (gateway.allowed_hosts?.length && !gateway.allowed_hosts.includes(allowedHost)) return null;
  const loopback = host === 'localhost' || host.endsWith('.localhost') || /^127\./u.test(host) || host === '[::1]';
  return host === '0.0.0.0' || host === '[::]' || (!target.startsWith('local:') && loopback) ? null : origin;
}

/** Registration identity owns selection, including Gateways awaiting address setup. */
export function savedGatewaySuggestions(gateways: readonly DesktopGatewaySource[], target: DesktopCloudRuntimeLinkTargetID) {
  return gateways.filter(gateway => gateway.local_enabled && gateway.trust_state !== 'revoked' && gateway.trust_state !== 'trust_changed')
    .map(gateway => {
      const endpoints = [...(gateway.member_endpoints ?? [])].sort((a,b) => a.priority - b.priority).map(endpoint => endpoint.address);
      // Only URL registrations have a fallback. Never infer addresses from a listener or SSH destination.
      const savedURL = !endpoints.length && gateway.connection_kind === 'url' ? gateway.gateway_url : undefined;
      const addresses = (savedURL ? [savedURL] : endpoints).flatMap(address => {
        const origin = gatewayRuntimeAddress(address, gateway, target);
        return origin && (address === origin || savedURL && address === origin + '/') ? [origin] : [];
      });
      return { gatewayID: gateway.gateway_id, name: gateway.display_name, addresses: [...new Set(addresses)] };
    });
}
