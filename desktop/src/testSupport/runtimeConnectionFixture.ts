import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { buildGatewayDesktopTarget, type DesktopSessionSummary } from '../main/desktopTarget';
import { memberFixture } from './gatewayMembershipFixture';
import { mixedEnvironmentFixture } from './mixedEnvironmentFixture';

/** Raw trusted observations, catalog and session inputs; no display ownership is seeded. */
export function runtimeConnectionFixture(options: {
  kind?: 'local_environment' | 'ssh_environment' | 'wsl_environment';
  cloudManagement?: boolean;
  gatewayWindow?: boolean;
  gatewayAvailable?: boolean;
} = {}) {
  const fixture = mixedEnvironmentFixture({ linkKind: options.kind });
  const memberships = ['Office', 'Lab'].map((gateway_name, index) => ({
    gateway_id: `service-${index}`, gateway_name, member_id: `member-${index}`,
    runtime_public_id: memberFixture.runtime_public_id, identity_fingerprint: `SHA256:${String(index).repeat(43)}`,
    phase: 'joined' as const, cloud_publication: index === 1,
    endpoints: [{ address: `https://${gateway_name.toLowerCase()}.internal:7443` }],
  }));
  const presences = Object.fromEntries(Object.entries(fixture.inputs.managedRuntimePresenceByTargetID).map(([id, presence]) => {
    if (presence.runtime_service.bindings?.cloud_link?.state !== 'linked') return [id, presence];
    return [id, { ...presence, runtime_service: { ...presence.runtime_service,
      gateway_memberships: memberships,
      capabilities: { ...presence.runtime_service.capabilities,
        cloud_link: { supported: options.cloudManagement !== false, reason_code: options.cloudManagement === false ? 'gateway_managed' : undefined },
        runtime_gateway: { supported: true },
      },
    } }];
  }));
  const gatewaySources: DesktopGatewaySource[] = memberships.map((member, index) => ({
    gateway_id: `registration-${index}`, display_name: member.gateway_name, local_enabled: true,
    connection_kind: 'url', management_capability: 'access_only', status: options.gatewayAvailable === false ? 'offline' : 'online',
    trust_state: 'paired', identity_fingerprint: member.identity_fingerprint, capabilities: ['member_access'],
    permissions: { access: true, manage_members: false, configure_cloud: false },
    created_at_ms: 1, updated_at_ms: 1,
    environments: [{ ...memberFixture, member_id: member.member_id, display_name: 'Catalog Runtime name' }],
  }));
  const target = buildGatewayDesktopTarget({ gatewayID: gatewaySources[0]!.gateway_id,
    gatewayEnvID: memberships[0]!.member_id, gatewaySessionID: 'fixture-session', label: 'Session Runtime name', gatewayLabel: 'Office' });
  const openSessions: DesktopSessionSummary[] = options.gatewayWindow ? [{
    session_key: target.session_key, target, lifecycle: 'open', entry_url: 'http://127.0.0.1:34567/',
  }] : [];
  const inputs = { ...fixture.inputs, managedRuntimePresenceByTargetID: presences, gatewaySources, openSessions };
  return { inputs, memberships, gatewaySources, snapshot: buildDesktopWelcomeSnapshot(inputs) };
}
