import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

/** Saved addresses are inputs for Runtime verification, not proof of connectivity or authority. */
export function savedGatewaySuggestions(gateways: readonly DesktopGatewaySource[], target: DesktopCloudRuntimeLinkTargetID) {
  const seen = new Set<string>();
  return gateways.filter(gateway => gateway.local_enabled && gateway.trust_state !== 'revoked' && gateway.trust_state !== 'trust_changed')
    .flatMap(gateway => {
      const endpoints = [...(gateway.member_endpoints ?? [])].sort((a,b) => a.priority - b.priority).map(endpoint => endpoint.address);
      // A saved URL is usable before catalog sync. Never infer an address from an SSH destination or listener binding.
      const savedURL = !endpoints.length && gateway.connection_kind === 'url' ? gateway.gateway_url : undefined;
      return (savedURL ? [savedURL] : endpoints).flatMap(address => {
        try {
          const url = new URL(address);
          const host = url.hostname;
          const allowedHost = host.replace(/^\[|\]$/gu, '').toLowerCase();
          if (gateway.allowed_hosts?.length && !gateway.allowed_hosts.includes(allowedHost)) return [];
          const loopback = host === 'localhost' || host.endsWith('.localhost') || /^127\./u.test(host) || host === '[::1]';
          if (url.protocol !== 'https:' || (address !== url.origin && !(savedURL && address === `${url.origin}/`))
            || url.username || url.password || url.search || url.hash || host === '0.0.0.0' || host === '[::]'
            || (!target.startsWith('local:') && loopback) || seen.has(url.origin)) return [];
          seen.add(url.origin);
          return [{gatewayID:gateway.gateway_id,name:gateway.display_name,address:url.origin}];
        } catch { return []; }
      });
    });
}
