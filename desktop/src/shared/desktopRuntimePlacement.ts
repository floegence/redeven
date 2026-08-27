import {
  desktopSSHAuthority,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHHostAccessDetails,
  normalizeDesktopSSHReleaseBaseURL,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHHostAccessDetails,
} from './desktopSSH';

export type DesktopRuntimeHostAccess =
  | Readonly<{
      kind: 'local_host';
    }>
  | Readonly<{
      kind: 'wsl_host';
      distribution_name: string;
      linux_user: string;
    }>
  | Readonly<{
      kind: 'ssh_host';
      ssh: DesktopSSHHostAccessDetails;
    }>;

export type DesktopContainerEngine = 'docker' | 'podman';

export type DesktopRuntimePlacement =
  | Readonly<{
      kind: 'host_process';
      runtime_root: string;
      runtime_state_root?: string;
      bootstrap_strategy?: DesktopSSHBootstrapStrategy;
      release_base_url?: string;
    }>
  | Readonly<{
      kind: 'container_process';
      container_engine: DesktopContainerEngine;
      container_id: string;
      container_ref: string;
      container_label: string;
      runtime_root: string;
      runtime_state_root?: string;
      bridge_strategy: 'exec_stream';
    }>;

export type DesktopRuntimeTargetID = `local:${string}` | `wsl:${string}` | `ssh:${string}`;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeTokenComponent(value: unknown, label: string): string {
  const text = compact(value);
  if (text === '') {
    throw new Error(`${label} is required.`);
  }
  if (/[\r\n]/u.test(text)) {
    throw new Error(`${label} must be a single line.`);
  }
  return text;
}

function normalizeOptionalRuntimeRoot(value: unknown): string {
  const text = compact(value);
  if (text === '') {
    return '';
  }
  if (/[\r\n]/u.test(text)) {
    throw new Error('Runtime root must be a single line.');
  }
  return text;
}

function normalizeOptionalRuntimeStateRoot(value: unknown): string | undefined {
  const text = normalizeOptionalRuntimeRoot(value);
  return text === '' ? undefined : text;
}

function normalizeRuntimeRoot(value: unknown, label: string): string {
  return normalizeTokenComponent(value, label);
}

export function normalizeDesktopContainerEngine(value: unknown): DesktopContainerEngine {
  const text = compact(value).toLowerCase();
  switch (text) {
    case 'docker':
    case 'podman':
      return text;
    default:
      throw new Error('Container engine must be Docker or Podman.');
  }
}

export function normalizeDesktopRuntimeHostAccess(value: unknown): DesktopRuntimeHostAccess {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = compact(record.kind);
  if (kind === 'local_host' || kind === '') {
    return { kind: 'local_host' };
  }
  if (kind === 'ssh_host') {
    const ssh = record.ssh && typeof record.ssh === 'object'
      ? record.ssh as Record<string, unknown>
      : {};
    return {
      kind: 'ssh_host',
      ssh: normalizeDesktopSSHHostAccessDetails({
        ssh_destination: ssh.ssh_destination,
        ssh_port: ssh.ssh_port,
        auth_mode: ssh.auth_mode,
        connect_timeout_seconds: ssh.connect_timeout_seconds,
      }),
    };
  }
  if (kind === 'wsl_host') {
    return {
      kind: 'wsl_host',
      distribution_name: normalizeTokenComponent(record.distribution_name, 'WSL distribution name'),
      linux_user: normalizeTokenComponent(record.linux_user, 'WSL Linux user'),
    };
  }
  throw new Error('Runtime host access must be local_host, wsl_host, or ssh_host.');
}

export function normalizeDesktopRuntimePlacement(value: unknown): DesktopRuntimePlacement {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = compact(record.kind);
  if (kind === 'host_process' || kind === '') {
    const runtimeStateRoot = normalizeOptionalRuntimeStateRoot(record.runtime_state_root);
    return {
      kind: 'host_process',
      runtime_root: normalizeOptionalRuntimeRoot(record.runtime_root),
      ...(runtimeStateRoot ? { runtime_state_root: runtimeStateRoot } : {}),
      bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy(record.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY),
      release_base_url: normalizeDesktopSSHReleaseBaseURL(record.release_base_url),
    };
  }
  if (kind === 'container_process') {
    const containerID = normalizeTokenComponent(record.container_id, 'Container ID');
    const containerLabel = compact(record.container_label) || containerID;
    const containerRef = compact(record.container_ref) || containerLabel || containerID;
    const runtimeStateRoot = normalizeOptionalRuntimeStateRoot(record.runtime_state_root);
    return {
      kind: 'container_process',
      container_engine: normalizeDesktopContainerEngine(record.container_engine),
      container_id: containerID,
      container_ref: normalizeTokenComponent(containerRef, 'Container reference'),
      container_label: containerLabel,
      runtime_root: normalizeRuntimeRoot(record.runtime_root, 'Container runtime root'),
      ...(runtimeStateRoot ? { runtime_state_root: runtimeStateRoot } : {}),
      bridge_strategy: 'exec_stream',
    };
  }
  throw new Error('Runtime placement must be host_process or container_process.');
}

export function desktopRuntimePlacementStateRoot(placement: DesktopRuntimePlacement): string {
  return compact(placement.runtime_state_root) || placement.runtime_root;
}

function hashRuntimeRoot(runtimeRoot: string): string {
  let hash = 0x811c9dc5;
  for (const char of runtimeRoot) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function desktopRuntimeContainerReference(
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
): string {
  return compact(placement.container_ref) || compact(placement.container_label) || compact(placement.container_id);
}

function normalizedSSHAuthority(ssh: DesktopSSHHostAccessDetails): string {
  return desktopSSHAuthority(ssh);
}

// IMPORTANT: Runtime target identity is the product boundary between host
// access and process placement. Do not add parallel local-container or
// ssh-container target kinds; encode placement inside this stable target key.
export function desktopRuntimeTargetID(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
  fallbackLocalID = 'local',
): DesktopRuntimeTargetID {
  if (hostAccess.kind === 'local_host') {
    if (placement.kind === 'container_process') {
      return `local:container:${encoded(placement.container_engine)}:${encoded(desktopRuntimeContainerReference(placement))}:${hashRuntimeRoot(desktopRuntimePlacementStateRoot(placement))}`;
    }
    return `local:host:${encoded(compact(fallbackLocalID) || 'local')}`;
  }
  if (hostAccess.kind === 'wsl_host') {
    if (placement.kind !== 'host_process') {
      throw new Error('WSL Runtime targets support host_process placement only.');
    }
    return `wsl:host:${encoded(hostAccess.distribution_name)}:${encoded(hostAccess.linux_user)}:${hashRuntimeRoot(desktopRuntimePlacementStateRoot(placement))}`;
  }
  const sshAuthority = normalizedSSHAuthority(hostAccess.ssh);
  if (placement.kind === 'container_process') {
    return `ssh:container:${encoded(sshAuthority)}:${encoded(placement.container_engine)}:${encoded(desktopRuntimeContainerReference(placement))}:${hashRuntimeRoot(desktopRuntimePlacementStateRoot(placement))}`;
  }
  return `ssh:host:${encoded(sshAuthority)}:${hashRuntimeRoot(desktopRuntimePlacementStateRoot(placement))}`;
}

export function desktopRuntimeTargetAutoStatusDetectionConfigurable(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): boolean {
  if (hostAccess.kind === 'wsl_host') {
    return false;
  }
  return !(hostAccess.kind === 'local_host' && placement.kind === 'container_process');
}

export function desktopRuntimeTargetAutoStatusDetectionEnabled(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
  configured: unknown,
): boolean {
  if (hostAccess.kind === 'wsl_host') {
    // WSL discovery decides whether the distribution is already running before
    // Desktop probes it. A saved preference must never wake a stopped distro.
    return true;
  }
  if (!desktopRuntimeTargetAutoStatusDetectionConfigurable(hostAccess, placement)) {
    return true;
  }
  return configured === true;
}
