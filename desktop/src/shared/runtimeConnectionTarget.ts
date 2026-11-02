import type {
  RuntimeServiceProviderConnectionState,
  RuntimeServiceCloudLinkBinding,
  RuntimeServiceCloudLinkState,
  RuntimeServiceSnapshot,
} from './runtimeService';
import type { DesktopRuntimeControlStatus } from './desktopRuntimePresence';

import type { DesktopRuntimeTargetKind, DesktopRuntimeTargetID } from './desktopRuntimePlacement';
export type { DesktopRuntimeTargetKind } from './desktopRuntimePlacement';

export type DesktopCloudEnvironmentOccupancyState =
  | 'available'
  | 'linked_here'
  | 'occupied_by_known_runtime'
  | 'occupied_by_provider_online_runtime';

export type DesktopCloudEnvironmentOccupancy = Readonly<{
  state: DesktopCloudEnvironmentOccupancyState;
  runtime_target_id?: DesktopRuntimeTargetID;
  runtime_kind?: DesktopRuntimeTargetKind;
  runtime_label?: string;
  provider_connection_state?: RuntimeServiceProviderConnectionState;
}>;

export type DesktopCloudEnvironmentCandidate = Readonly<{
  provider_environment_id: string;
  label: string;
  cloud_origin: string;
  cloud_id: string;
  env_public_id: string;
  access_point_origin: string;
  provider_label?: string;
  route_state: 'online' | 'offline' | 'unknown';
  occupancy: DesktopCloudEnvironmentOccupancy;
  disabled_reason_code?: string;
  disabled_reason?: string;
}>;

/** Runtime-owned management facts and derived connection presentation; Cloud never grants host authority. */
export type DesktopRuntimeConnectionTarget = Readonly<{
  id: DesktopRuntimeTargetID;
  kind: DesktopRuntimeTargetKind;
  environment_id: string;
  label: string;
  runtime_key: string;
  runtime_url: string;
  runtime_running: boolean;
  runtime_openable: boolean;
  runtime_control_status: DesktopRuntimeControlStatus;
  runtime_service?: RuntimeServiceSnapshot;
  provider_connection_state: RuntimeServiceProviderConnectionState;
  cloud_link_state: RuntimeServiceCloudLinkState;
  cloud_link_binding?: RuntimeServiceCloudLinkBinding;
  cloud_origin?: string;
  cloud_origin_supported: boolean;
  cloud_id?: string;
  env_public_id?: string;
  access_point_origin?: string;
  can_connect_cloud: boolean;
  can_disconnect_cloud: boolean;
  blocked_reason_code?: string;
  blocked_reason?: string;
}>;
