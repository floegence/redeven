import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { containerRuntimeExecCommand } from './containerRuntime';

export type RuntimePlacementBridgeKind = 'host_process' | 'container_exec_stream';

export type RuntimePlacementBridgePlan = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  bridge_kind: RuntimePlacementBridgeKind;
  command: readonly string[];
  requires_published_port: false;
  exposes_loopback_only: true;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

// IMPORTANT: Runtime placement bridges must be derived from host access and
// placement facts. Do not add provider-card shortcuts or local-container /
// ssh-container target kinds when wiring new runtime locations.
export function buildRuntimePlacementBridgePlan(input: Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path?: string;
}>): RuntimePlacementBridgePlan {
  const runtimeBinaryPath = compact(input.runtime_binary_path) || 'redeven';
  if (input.placement.kind === 'host_process') {
    return {
      host_access: input.host_access,
      placement: input.placement,
      bridge_kind: 'host_process',
      command: [runtimeBinaryPath],
      requires_published_port: false,
      exposes_loopback_only: true,
    };
  }
  return {
    host_access: input.host_access,
    placement: input.placement,
    bridge_kind: 'container_exec_stream',
    command: containerRuntimeExecCommand({
      engine: input.placement.container_engine,
      container_id: input.placement.container_id,
      argv: [runtimeBinaryPath, 'desktop-bridge'],
    }),
    requires_published_port: false,
    exposes_loopback_only: true,
  };
}
