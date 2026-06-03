import {
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
  desktopRuntimePlacementStateRoot,
} from '../shared/desktopRuntimePlacement';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import {
  containerRuntimeExecCommand,
  containerRuntimeRootShellPrelude,
} from './containerRuntime';

export type RuntimePlacementBridgeKind = 'host_process' | 'container_exec_stream';
export type RuntimePlacementBridgeCommandKind = 'runtime' | 'gateway';

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
  _commandKind: RuntimePlacementBridgeCommandKind = 'runtime',
): readonly string[] {
  const command = [runtimeBinaryPath, 'desktop-bridge'];
  const cleanStateRoot = compact(stateRoot);
  return cleanStateRoot === ''
    ? command
    : [...command, '--state-root', cleanStateRoot];
}

function hostProcessDesktopBridgeCommand(
  runtimeBinaryPath: string,
  installRoot: string,
  stateRoot: string,
  commandKind: RuntimePlacementBridgeCommandKind,
): readonly string[] {
  const cleanStateRoot = compact(stateRoot);
  if (cleanStateRoot === '') {
    return desktopBridgeCommand(runtimeBinaryPath, undefined, commandKind);
  }
  const cleanInstallRoot = compact(installRoot) || cleanStateRoot;
  const defaultBinary = '${install_root%/}/runtime/managed/bin/redeven';
  const bridgeDriver = [
    'set -eu',
    'install_root="$1"',
    `if [ "$install_root" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "host HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    '  install_root="${HOME%/}/.redeven"',
    'fi',
    'case "$install_root" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "host HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    install_root="\${HOME%/}/.redeven/\${install_root#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'runtime_binary_path="$2"',
    `if [ "$runtime_binary_path" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    `  runtime_binary_path="${defaultBinary}"`,
    'fi',
    'case "$runtime_binary_path" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "host HOME is unavailable; set Runtime binary path to an absolute path" >&2',
    '      exit 1',
    '    fi',
    `    runtime_binary_path="\${HOME%/}/.redeven/\${runtime_binary_path#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'state_root="$3"',
    `if [ "$state_root" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "host HOME is unavailable; set Runtime State Root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    '  state_root="${HOME%/}/.redeven"',
    'fi',
    'case "$state_root" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "host HOME is unavailable; set Runtime State Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    state_root="\${HOME%/}/.redeven/\${state_root#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'exec "$runtime_binary_path" desktop-bridge --state-root "$state_root"',
  ].join('\n');
  return [
    'sh',
    '-c',
    bridgeDriver,
    'redeven-host-desktop-bridge',
    cleanInstallRoot,
    runtimeBinaryPath,
    cleanStateRoot,
  ];
}

function containerDesktopBridgeCommand(
  runtimeBinaryPath: string,
  installRoot: string,
  stateRoot: string,
  _commandKind: RuntimePlacementBridgeCommandKind,
): readonly string[] {
  const defaultBinary = '${runtime_root%/}/runtime/managed/bin/redeven';
  const bridgeDriver = [
    'set -eu',
    'runtime_root="$1"',
    containerRuntimeRootShellPrelude(),
    'runtime_binary_path="$2"',
    `if [ "$runtime_binary_path" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    `  runtime_binary_path="${defaultBinary}"`,
    'fi',
    'case "$runtime_binary_path" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    `    runtime_binary_path="\${runtime_root%/}/\${runtime_binary_path#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'state_root="$3"',
    containerRuntimeRootShellPrelude('state_root'),
    'exec "$runtime_binary_path" desktop-bridge --state-root "$state_root"',
  ].join('\n');
  return [
    'sh',
    '-c',
    bridgeDriver,
    'redeven-container-desktop-bridge',
    installRoot,
    runtimeBinaryPath,
    stateRoot,
  ];
}

// IMPORTANT: Runtime placement bridges must be derived from host access and
// placement facts. Do not add provider-card shortcuts or local-container /
// ssh-container target kinds when wiring new runtime locations.
export function buildRuntimePlacementBridgePlan(input: Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path?: string;
  command_kind?: RuntimePlacementBridgeCommandKind;
}>): RuntimePlacementBridgePlan {
  const runtimeBinaryPath = compact(input.runtime_binary_path) || 'redeven';
  const commandKind = input.command_kind ?? 'runtime';
  const stateRoot = desktopRuntimePlacementStateRoot(input.placement);
  if (input.placement.kind === 'host_process') {
    return {
      host_access: input.host_access,
      placement: input.placement,
      bridge_kind: 'host_process',
      command: hostProcessDesktopBridgeCommand(runtimeBinaryPath, input.placement.runtime_root, stateRoot, commandKind),
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
      // binary path. Do not fall back to PATH lookup; Start Runtime owns
      // install, daemon startup, and health readiness before this bridge
      // attach stream starts.
      argv: containerDesktopBridgeCommand(runtimeBinaryPath, input.placement.runtime_root, stateRoot, commandKind),
    }),
    requires_published_port: false,
    exposes_loopback_only: true,
  };
}
