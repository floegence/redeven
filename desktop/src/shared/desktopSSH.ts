export const DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR = 'remote_default';
export const DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR_LABEL = 'Remote user cache';
export const DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY = 'auto';
export const DEFAULT_DESKTOP_SSH_AUTH_MODE = 'key_agent';
export const DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL = '';
export const DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL = 'Public GitHub Releases';
export const DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS = 10;

export type DesktopSSHBootstrapStrategy = 'auto' | 'desktop_upload' | 'remote_install';
export type DesktopSSHAuthMode = 'key_agent' | 'password';

export type DesktopSSHHostAccessDetails = Readonly<{
  ssh_destination: string;
  ssh_port: number | null;
  auth_mode: DesktopSSHAuthMode;
  remote_install_dir: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
  connect_timeout_seconds?: number | null;
}>;

export type DesktopSSHEnvironmentDetails = DesktopSSHHostAccessDetails;

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

export function normalizeDesktopSSHBootstrapStrategy(value: unknown): DesktopSSHBootstrapStrategy {
  const text = compact(value).toLowerCase();
  switch (text) {
    case '':
    case DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY:
      return DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY;
    case 'desktop_upload':
    case 'remote_install':
      return text;
    default:
      throw new Error('SSH bootstrap delivery must be Automatic, Desktop Upload, or Remote Install.');
  }
}

export function normalizeDesktopSSHAuthMode(value: unknown): DesktopSSHAuthMode {
  const text = compact(value).toLowerCase();
  switch (text) {
    case '':
    case DEFAULT_DESKTOP_SSH_AUTH_MODE:
    case 'key':
    case 'agent':
    case 'key_or_agent':
      return DEFAULT_DESKTOP_SSH_AUTH_MODE;
    case 'password':
      return 'password';
    default:
      throw new Error('SSH authentication must use Key / agent or Password prompt.');
  }
}

export function normalizeDesktopSSHReleaseBaseURL(value: unknown): string {
  const text = compact(value);
  if (text === '') {
    return DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL;
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('Release base URL must be an absolute http:// or https:// URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Release base URL must use http:// or https://.');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/u, '');
}

export function normalizeDesktopSSHHostAccessDetails(
  value: Readonly<{
    ssh_destination: unknown;
    ssh_port: unknown;
    auth_mode?: unknown;
    remote_install_dir: unknown;
    bootstrap_strategy: unknown;
    release_base_url: unknown;
    connect_timeout_seconds?: unknown;
  }>,
): DesktopSSHHostAccessDetails {
  return {
    ssh_destination: normalizeDesktopSSHDestination(value.ssh_destination),
    ssh_port: normalizeDesktopSSHPort(value.ssh_port),
    auth_mode: normalizeDesktopSSHAuthMode(value.auth_mode),
    remote_install_dir: normalizeDesktopSSHRemoteInstallDir(value.remote_install_dir),
    bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy(value.bootstrap_strategy),
    release_base_url: normalizeDesktopSSHReleaseBaseURL(value.release_base_url),
    connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds(value.connect_timeout_seconds),
  };
}

export function normalizeDesktopSSHConnectTimeoutSeconds(value: unknown): number | null {
  if (value === null || value === undefined) {
    return DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS;
  }
  const text = String(value).trim();
  if (text === '') {
    return DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS;
  }
  const num = Number(text);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error('SSH connect timeout must be a number of at least 1 second.');
  }
  return num;
}

export function normalizeDesktopSSHEnvironmentDetails(
  value: Readonly<{
    ssh_destination: unknown;
    ssh_port: unknown;
    auth_mode?: unknown;
    remote_install_dir: unknown;
    bootstrap_strategy: unknown;
    release_base_url: unknown;
    connect_timeout_seconds?: unknown;
  }>,
): DesktopSSHEnvironmentDetails {
  return normalizeDesktopSSHHostAccessDetails(value);
}

export function desktopSSHAuthority(value: DesktopSSHHostAccessDetails): string {
  const normalized = normalizeDesktopSSHHostAccessDetails(value);
  if (normalized.ssh_port === null) {
    return normalized.ssh_destination;
  }
  return `${normalized.ssh_destination}:${normalized.ssh_port}`;
}

export function desktopSSHEnvironmentID(value: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  const normalized = normalizeDesktopSSHEnvironmentDetails(value);
  return `ssh:${encodeURIComponent(normalized.ssh_destination)}:${normalized.ssh_port ?? 'default'}:${encodeURIComponent(normalized.auth_mode)}:${encodeURIComponent(normalized.remote_install_dir)}`;
}

export function defaultSavedSSHEnvironmentLabel(value: DesktopSSHHostAccessDetails): string {
  return desktopSSHAuthority(value);
}
