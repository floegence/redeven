import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

/** Suggest only confirmed endpoints from the current, trusted local inventory. */
export function localGatewaySuggestions(gateways: readonly DesktopGatewaySource[], target: DesktopCloudRuntimeLinkTargetID) {
  const seen = new Set<string>();
  return gateways.filter(gateway => gateway.local_enabled && gateway.connection_kind === 'local_host'
    && gateway.status === 'online' && gateway.trust_state === 'paired' && gateway.listener_running === true)
    .flatMap(gateway => [...(gateway.member_endpoints ?? [])].sort((a,b) => a.priority - b.priority).flatMap(endpoint => {
      try {
        const url = new URL(endpoint.address);
        const host = url.hostname;
        const allowedHost = host.replace(/^\[|\]$/gu, '').toLowerCase();
        if (gateway.allowed_hosts?.length && !gateway.allowed_hosts.includes(allowedHost)) return [];
        const loopback = host === 'localhost' || host.endsWith('.localhost') || /^127\./u.test(host) || host === '[::1]';
        if (url.protocol !== 'https:' || url.origin !== endpoint.address || url.username || url.password || url.search || url.hash
          || host === '0.0.0.0' || host === '[::]' || (!target.startsWith('local:') && loopback) || seen.has(endpoint.address)) return [];
        seen.add(endpoint.address);
        return [{gatewayID:gateway.gateway_id,name:gateway.display_name,address:endpoint.address}];
      } catch { return []; }
    }));
}
