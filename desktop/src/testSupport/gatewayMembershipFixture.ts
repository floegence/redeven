import { GATEWAY_PROTOCOL_VERSION, type GatewayMember } from '../shared/gatewayMembership';
import type { GatewayCatalogResponse } from '../main/gatewayClient';
import type { GatewayRecord } from '../main/gatewayStore';

export const memberFixture: GatewayMember = {
  member_id: 'member_fixture', runtime_public_id: 'runtime_fixture', member_version: 1, display_name: 'Runtime',
  state: 'active', connected: true, last_seen_at_unix_ms: 1, cloud_permission: 'inherit', effective_cloud_allowed: false,
  cloud_state: 'not_published', cloud_revocation_pending: false, metadata: { hostname: 'runtime.internal', os: 'linux', arch: 'arm64', version: 'test' },
};
export const catalogFixture: GatewayCatalogResponse = {
  protocol_version: GATEWAY_PROTOCOL_VERSION, gateway: { gateway_id: 'gateway_fixture', display_name: 'Gateway', gateway_public_key_fingerprint: 'fixture',
    member_url: 'https://gateway.internal:7443', member_tls_root_pem: 'fixture', permissions: { access: true, manage_members: true, configure_cloud: true } },
  members: [memberFixture], revision: 1, policy: { revision: 1, default_cloud_allowed: false, publication_mode: 'manual' },
  rebuild_required: false, hook_status: { 'member.admit': 'not_configured', 'access.open': 'not_configured', 'cloud.publish': 'not_configured' },
};
export const gatewayRecordFixture: GatewayRecord = {
  schema_version: 4, gateway_id: 'registration_fixture', display_name: 'Gateway', local_enabled: true,
  connection: { kind: 'url', base_url: 'https://gateway.example/' }, created_at_ms: 1, updated_at_ms: 1,
};

export const invitationFixture = {
  protocol_version: GATEWAY_PROTOCOL_VERSION, gateway_id: 'gateway_fixture', invitation_id: 'invitation_fixture',
  gateway_url: 'https://gateway.internal:7443', gateway_public_key: 'a'.repeat(43),
  gateway_tls_root_pem: '-----BEGIN CERTIFICATE-----\ntest', token: 'b'.repeat(43), signature: 'c'.repeat(86),
  issued_at_unix_ms: 1900000000000, expires_at_unix_ms: 1900000600000,
};
