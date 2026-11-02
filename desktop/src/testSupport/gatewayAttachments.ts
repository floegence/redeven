import type { GatewayAttachmentSnapshot, GatewayAttachmentStatus } from '../shared/gatewayJoin';

export function gatewayAttachment(overrides: Partial<GatewayAttachmentStatus> = {}): GatewayAttachmentStatus {
  return { gateway_id: 'gateway', gateway_name: 'Office Gateway', attachment_id: 'attachment',
    attachment_state: 'joined', connection_state: 'connected', phase: 'joined', route_selected: false, endpoints: [], ...overrides };
}

export function gatewaySnapshot(attachments: readonly GatewayAttachmentStatus[] = [], runtimeRunning = true): GatewayAttachmentSnapshot {
  return { attachments, runtime_running: runtimeRunning, observed_at_unix_ms: 1900000000000,
    counts: { total: attachments.length, joined: attachments.filter(item => item.attachment_state === 'joined').length,
      connected: attachments.filter(item => item.attachment_state === 'joined' && item.connection_state === 'connected').length,
      joining: attachments.filter(item => item.attachment_state === 'joining').length,
      removing: attachments.filter(item => item.attachment_state === 'removal_pending').length } };
}
