import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function compareSSHConfigHosts(left: DesktopSSHConfigHost, right: DesktopSSHConfigHost): number {
  return left.alias.localeCompare(right.alias);
}

function sshConfigHostMatchRank(host: DesktopSSHConfigHost, query: string): number | null {
  const alias = normalizeSearchValue(host.alias);
  if (alias === query) {
    return 0;
  }
  if (alias.startsWith(query)) {
    return 1;
  }
  if (alias.includes(query)) {
    return 2;
  }
  const metadata = [
    host.host_name,
    host.user,
    host.port == null ? '' : String(host.port),
  ].map(normalizeSearchValue);
  return metadata.some((value) => value.includes(query)) ? 3 : null;
}

export function filterAndRankSSHConfigHosts(
  hosts: readonly DesktopSSHConfigHost[],
  rawQuery: string,
): readonly DesktopSSHConfigHost[] {
  const query = normalizeSearchValue(rawQuery);
  if (query === '') {
    return [...hosts].sort(compareSSHConfigHosts);
  }
  return hosts
    .map((host) => ({ host, rank: sshConfigHostMatchRank(host, query) }))
    .filter((candidate): candidate is Readonly<{ host: DesktopSSHConfigHost; rank: number }> => candidate.rank !== null)
    .sort((left, right) => left.rank - right.rank || compareSSHConfigHosts(left.host, right.host))
    .map((candidate) => candidate.host);
}

export function sshConfigHostEndpointLabel(host: DesktopSSHConfigHost): string {
  const endpoint = host.host_name || host.alias;
  return host.user ? `${host.user}@${endpoint}` : endpoint;
}
