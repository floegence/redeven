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

function desktopBridgeCommand(
  runtimeBinaryPath: string,
  stateRoot?: string,
): readonly string[] {
  const command = [runtimeBinaryPath, 'desktop-bridge'];
  const cleanStateRoot = compact(stateRoot);
  return cleanStateRoot === ''
    ? command
    : [...command, '--state-root', cleanStateRoot];
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
      command: desktopBridgeCommand(runtimeBinaryPath),
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
      env: {
        REDEVEN_DESKTOP_OWNER_ID: undefined,
      },
      // IMPORTANT: Container targets execute the runtime binary inside the
      // container after placement bootstrap has resolved the container-local
      // binary path. Do not fall back to PATH lookup; bootstrap owns install
      // and version readiness before the bridge stream starts.
      argv: desktopBridgeCommand(runtimeBinaryPath, input.placement.runtime_state_root),
    }),
    requires_published_port: false,
    exposes_loopback_only: true,
  };
}
