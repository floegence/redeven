export const HOST_APPLICATION_COMPONENTS_CHANNEL = 'redeven-desktop:host-application-components';
export const HOST_APPLICATION_COMPONENTS_PROGRESS = 'redeven-desktop:host-application-components-progress';
export type HostApplicationComponentsRequest =
  | { action: 'acquire'; architecture: 'amd64' | 'arm64' }
  | { action: 'read'; offset: number }
  | { action: 'cancel' };
export type HostApplicationComponentsResult = { ok: boolean; size?: number; data?: Uint8Array };
export type HostApplicationComponentsProgress = { received_bytes: number; expected_bytes: number };
