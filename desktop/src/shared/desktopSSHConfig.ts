import { normalizeDesktopSSHPort } from './desktopSSH';

export const DESKTOP_LAUNCHER_GET_SSH_CONFIG_HOSTS_CHANNEL = 'redeven-desktop:launcher-get-ssh-config-hosts';

export type DesktopSSHConfigHost = Readonly<{
  alias: string;
  host_name: string;
  user: string;
  port: number | null;
  source_path: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopSSHConfigHost(value: unknown): DesktopSSHConfigHost | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const alias = compact(record.alias);
  if (alias === '') {
    return null;
  }
  let port: number | null = null;
  try {
    port = normalizeDesktopSSHPort(record.port);
  } catch {
    port = null;
  }
  return {
    alias,
    host_name: compact(record.host_name),
    user: compact(record.user),
    port,
    source_path: compact(record.source_path),
  };
}

export function normalizeDesktopSSHConfigHosts(value: unknown): readonly DesktopSSHConfigHost[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hosts: DesktopSSHConfigHost[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const host = normalizeDesktopSSHConfigHost(candidate);
    if (!host || seen.has(host.alias)) {
      continue;
    }
    seen.add(host.alias);
    hosts.push(host);
  }
  hosts.sort((left, right) => left.alias.localeCompare(right.alias));
  return hosts;
}
