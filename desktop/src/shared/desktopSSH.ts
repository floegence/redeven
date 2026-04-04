export const DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR = 'remote_default';
export const DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR_LABEL = 'Remote user cache';

export type DesktopSSHEnvironmentDetails = Readonly<{
  ssh_destination: string;
  ssh_port: number | null;
  remote_install_dir: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopSSHDestination(value: unknown): string {
  const text = compact(value);
  if (text === '') {
    throw new Error('SSH destination is required.');
  }
  if (text.includes('://')) {
    throw new Error('SSH destination must not include a URL scheme.');
  }
  if (/\s/u.test(text)) {
    throw new Error('SSH destination must not contain whitespace.');
  }
  if (text.startsWith('-')) {
    throw new Error('SSH destination must not start with "-".');
  }
  return text;
}

export function normalizeDesktopSSHPort(value: unknown): number | null {
  const text = compact(value);
  if (text === '') {
    return null;
  }
  const numeric = Number.parseInt(text, 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new Error('SSH port must be between 1 and 65535.');
  }
  return numeric;
}

export function normalizeDesktopSSHRemoteInstallDir(value: unknown): string {
  const text = compact(value);
  if (text === '') {
    return DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR;
  }
  if (/[\r\n]/u.test(text)) {
    throw new Error('Remote install directory must be a single line.');
  }
  if (text !== DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR && !text.startsWith('/')) {
    throw new Error('Remote install directory must be an absolute path or use the default remote cache.');
  }
  return text;
}

export function normalizeDesktopSSHEnvironmentDetails(
  value: DesktopSSHEnvironmentDetails,
): DesktopSSHEnvironmentDetails {
  return {
    ssh_destination: normalizeDesktopSSHDestination(value.ssh_destination),
    ssh_port: normalizeDesktopSSHPort(value.ssh_port),
    remote_install_dir: normalizeDesktopSSHRemoteInstallDir(value.remote_install_dir),
  };
}

export function desktopSSHAuthority(value: DesktopSSHEnvironmentDetails): string {
  const normalized = normalizeDesktopSSHEnvironmentDetails(value);
  if (normalized.ssh_port === null) {
    return normalized.ssh_destination;
  }
  return `${normalized.ssh_destination}:${normalized.ssh_port}`;
}

export function desktopSSHEnvironmentID(value: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  const normalized = normalizeDesktopSSHEnvironmentDetails(value);
  return `ssh:${encodeURIComponent(normalized.ssh_destination)}:${normalized.ssh_port ?? 'default'}:${encodeURIComponent(normalized.remote_install_dir)}`;
}

export function defaultSavedSSHEnvironmentLabel(value: DesktopSSHEnvironmentDetails): string {
  return desktopSSHAuthority(value);
}
