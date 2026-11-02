import { randomUUID } from 'node:crypto';
import { GatewayClientError, type GatewayClient, type GatewayCatalogResponse } from './gatewayClient';
import { createRuntimeAttachmentTransport, type RuntimeAttachmentTransport } from './gatewayMemberTransport';
import { gatewayProtocolID, type GatewayRecord } from './gatewayStore';
import type { RuntimeAttachment } from '../shared/gatewayMembership';
import { probeExternalLocalUIStartup } from './runtimeState';
import type { StartupReport } from './startup';

export type GatewayEnvironmentAccess = Readonly<{
  sessionID: string;
  startup: StartupReport;
  transport: RuntimeAttachmentTransport;
  close: () => Promise<void>;
}>;

export async function prepareGatewayEnvironmentAccess(
  record: GatewayRecord,
  member: RuntimeAttachment,
  catalog: GatewayCatalogResponse,
  client: GatewayClient,
  signal?: AbortSignal,
): Promise<GatewayEnvironmentAccess> {
  if (!catalog.gateway.permissions.access || member.state !== 'active' || !member.connected) {
    throw new GatewayClientError('ATTACHMENT_OFFLINE', 'This Runtime member is unavailable.');
  }
  const transport = await createRuntimeAttachmentTransport({
    memberID: member.attachment_id, memberVersion: member.attachment_version,
    runtimeID: member.runtime_public_id, gatewayID: gatewayProtocolID(record),
    gatewayEndpoints: catalog.gateway.endpoints, gatewayTLSRootPEM: catalog.gateway.tls_root_pem,
    gatewayConnectionPath: client.memberConnectionPath(catalog),
    refreshService: signal => client.memberService(record, member.attachment_id, member.attachment_version, { signal }),
    acquire: signal => client.openMember(record, member.attachment_id, { signal }), signal,
  });
  try {
    const sessionID = randomUUID();
    const result = await probeExternalLocalUIStartup(transport.origin, {
      signal, agent: transport.agent, gatewayEndpoint: true, timeoutMs: 15_000,
      shellCacheScope: `gateway:${record.connection_id}:${member.attachment_id}:${sessionID}`,
    });
    if (!result.ok) throw new GatewayClientError('GATEWAY_TARGET_UNAVAILABLE', `Runtime application access could not be established (${result.failure.kind}${result.failure.code ? `: ${result.failure.code}` : ''}${result.failure.status_code ? `: HTTP ${result.failure.status_code}` : ''}).`);
    // Signed member identity owns the origin. Public health metadata cannot
    // retarget this session or grant a trusted Runtime management channel.
    return { sessionID, transport, close: transport.close,
      startup: { ...result.value, local_ui_url: transport.origin, local_ui_urls: [transport.origin] } };
  } catch (error) { await transport.close(); throw error; }
}
