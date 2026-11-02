import { GATEWAY_PROTOCOL_VERSION, type RuntimeAttachment, type GatewayInvitationCodeDelivery } from '../shared/gatewayMembership';
import type { GatewayCatalogResponse } from '../main/gatewayClient';
import type { GatewayRecord } from '../main/gatewayStore';

export const memberFixture: RuntimeAttachment = {
  attachment_id: 'member_fixture', runtime_public_id: 'runtime_fixture', attachment_version: 1, display_name: 'Runtime',
  state: 'active', connected: true, last_seen_at_unix_ms: 1, egress_permission: 'inherit', effective_egress_allowed: false,
  metadata: { hostname: 'runtime.internal', os: 'linux', arch: 'arm64', version: 'test' },
};
export const catalogFixture: GatewayCatalogResponse = {
  protocol_version: GATEWAY_PROTOCOL_VERSION, gateway: { gateway_id: 'gateway_fixture', display_name: 'Gateway', gateway_public_key_fingerprint: 'fixture', listener_address: ':7443',
    listener_addresses: [':7443'], active_listener_addresses:[],allowed_hosts:[],listener_restart_required:false, listener_running: true, endpoint_last_used_at: {},
    endpoints: [{ endpoint_id: 'lan', address: 'https://gateway.internal:7443', scope: 'lan', priority: 0 }], tls_root_pem: 'fixture', permissions: { access: true, manage_attachments: true, manage_network: true } },
  attachments: [memberFixture], revision: 1, policy: { revision: 1, default_egress_allowed: false, destinations: [] }, hook_status: { 'attachment.admit': 'not_configured', 'access.open': 'not_configured', 'egress.open': 'not_configured' },
};
export const gatewayRecordFixture: GatewayRecord = {
  schema_version: 5, connection_id: 'registration_fixture', display_name: 'Gateway', local_enabled: true,
  connection: { kind: 'url', base_url: 'https://gateway.example/' }, created_at_ms: 1, updated_at_ms: 1,
};

export const invitationFixture = {
  protocol_version: GATEWAY_PROTOCOL_VERSION, gateway_id: 'gateway_fixture', gateway_name: 'Office Gateway', invitation_id: 'invitation_fixture',
  share_address: 'https://gateway.internal:7443', share_addresses: ['https://gateway.internal:7443'], gateway_public_key: 'a'.repeat(43),
  code: '123456789ABCDEFGHJKMNPQRSTV', signature: 'c'.repeat(86),
  issued_at_unix_ms: 1900000000000, expires_at_unix_ms: 1900000600000,
} satisfies GatewayInvitationCodeDelivery;
