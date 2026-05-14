import {
  desktopSSHAuthority,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from './desktopSSH';

export type DesktopRuntimeHostAccess =
  | Readonly<{
      kind: 'local_host';
    }>
  | Readonly<{
      kind: 'ssh_host';
      ssh: DesktopSSHEnvironmentDetails;
    }>;

export type DesktopContainerEngine = 'docker' | 'podman';
export type DesktopRuntimeContainerOwner = 'desktop' | 'external';

export type DesktopRuntimePlacement =
  | Readonly<{
      kind: 'host_process';
      install_dir: string;
    }>
  | Readonly<{
      kind: 'container_process';
      container_engine: DesktopContainerEngine;
      container_id: string;
      container_label: string;
      container_owner: DesktopRuntimeContainerOwner;
      runtime_root: string;
      bridge_strategy: 'exec_stream';
    }>;

export type DesktopRuntimeTargetID = `local:${string}` | `ssh:${string}`;

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

function normalizeInstallDir(value: unknown): string {
  const text = compact(value);
  if (text === '') {
    return '';
  }
  if (/[\r\n]/u.test(text)) {
    throw new Error('Runtime install directory must be a single line.');
  }
  return text;
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

export function normalizeDesktopRuntimeContainerOwner(value: unknown): DesktopRuntimeContainerOwner {
  return compact(value).toLowerCase() === 'desktop' ? 'desktop' : 'external';
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
      ssh: normalizeDesktopSSHEnvironmentDetails({
        ssh_destination: ssh.ssh_destination,
        ssh_port: ssh.ssh_port,
        auth_mode: ssh.auth_mode,
        remote_install_dir: ssh.remote_install_dir,
        bootstrap_strategy: ssh.bootstrap_strategy,
        release_base_url: ssh.release_base_url,
        connect_timeout_seconds: ssh.connect_timeout_seconds,
      }),
    };
  }
  throw new Error('Runtime host access must be local_host or ssh_host.');
}

export function normalizeDesktopRuntimePlacement(value: unknown): DesktopRuntimePlacement {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = compact(record.kind);
  if (kind === 'host_process' || kind === '') {
    return {
      kind: 'host_process',
      install_dir: normalizeInstallDir(record.install_dir),
    };
  }
  if (kind === 'container_process') {
    return {
      kind: 'container_process',
      container_engine: normalizeDesktopContainerEngine(record.container_engine),
      container_id: normalizeTokenComponent(record.container_id, 'Container ID'),
      container_label: compact(record.container_label) || compact(record.container_id),
      container_owner: normalizeDesktopRuntimeContainerOwner(record.container_owner),
      runtime_root: normalizeTokenComponent(record.runtime_root, 'Container runtime root'),
      bridge_strategy: 'exec_stream',
    };
  }
  throw new Error('Runtime placement must be host_process or container_process.');
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

function normalizedSSHAuthority(ssh: DesktopSSHEnvironmentDetails): string {
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
      return `local:container:${encoded(placement.container_engine)}:${encoded(placement.container_id)}:${hashRuntimeRoot(placement.runtime_root)}`;
    }
    return `local:host:${encoded(compact(fallbackLocalID) || 'local')}`;
  }
  const sshAuthority = normalizedSSHAuthority(hostAccess.ssh);
  if (placement.kind === 'container_process') {
    return `ssh:container:${encoded(sshAuthority)}:${encoded(placement.container_engine)}:${encoded(placement.container_id)}:${hashRuntimeRoot(placement.runtime_root)}`;
  }
  return `ssh:host:${encoded(sshAuthority)}:${encoded(hostAccess.ssh.remote_install_dir)}`;
}
