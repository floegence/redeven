import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type EnvironmentLibraryDisplayGroup = Readonly<{
  id: string;
  primary_entry: DesktopEnvironmentEntry;
  provider_entry?: DesktopEnvironmentEntry;
  member_entries: readonly DesktopEnvironmentEntry[];
  member_ids: readonly string[];
  search_text: string;
  pinned: boolean;
  highlighted_owner_id?: string;
}>;

export function environmentLibrarySearchText(entry: DesktopEnvironmentEntry): string {
  return [
    entry.label, entry.local_ui_url, ...(entry.local_ui_urls ?? []), entry.remote_environment_url,
    entry.secondary_text, entry.control_plane_label, entry.provider_origin, entry.env_public_id,
    entry.gateway_label, entry.gateway_env_id, entry.gateway_endpoint_label, entry.gateway_environment_origin?.label,
    entry.ssh_details?.ssh_destination, entry.ssh_details?.runtime_root,
    entry.ssh_details?.release_base_url, entry.ssh_details?.bootstrap_strategy,
    entry.managed_runtime_host_access?.kind === 'wsl_host' ? entry.managed_runtime_host_access.distribution_name : '',
  ].filter(Boolean).join('\n').toLowerCase();
}

function providerIdentityMatches(runtime: DesktopEnvironmentEntry, provider: DesktopEnvironmentEntry): boolean {
  const target = runtime.provider_runtime_link_target;
  return Boolean(target
    && ['linked', 'linking', 'disconnecting'].includes(target.provider_link_state)
    && target.provider_origin && target.provider_id && target.env_public_id
    && target.id === provider.provider_linked_runtime_summary?.runtime_target_id
    && target.provider_origin === provider.provider_origin
    && target.provider_id === provider.provider_id
    && target.env_public_id === provider.env_public_id);
}

/** One visual group, separate original entries and action owners. */
export function buildEnvironmentLibraryDisplayGroups(
  entries: readonly DesktopEnvironmentEntry[],
): readonly EnvironmentLibraryDisplayGroup[] {
  const runtimes = entries.filter(entry => entry.provider_runtime_link_target
    && ['local_environment', 'ssh_environment', 'wsl_environment'].includes(entry.kind));
  const pairs = new Map<string, DesktopEnvironmentEntry>();
  for (const provider of entries.filter(entry => entry.kind === 'provider_environment')) {
    const runtime = runtimes.find(entry => !pairs.has(entry.id) && providerIdentityMatches(entry, provider));
    if (runtime) {
      pairs.set(runtime.id, provider);
      pairs.set(provider.id, runtime);
    }
  }

  const consumed = new Set<string>();
  const groups: EnvironmentLibraryDisplayGroup[] = [];
  for (const entry of entries) {
    if (consumed.has(entry.id)) continue;
    const partner = pairs.get(entry.id);
    const primary = partner && entry.kind === 'provider_environment' ? partner : entry;
    const provider = partner ? (entry.kind === 'provider_environment' ? entry : partner) : undefined;
    const members = provider ? [primary, provider] : [primary];
    for (const member of members) consumed.add(member.id);
    groups.push({
      id: primary.id,
      primary_entry: primary,
      ...(provider ? { provider_entry: provider } : {}),
      member_entries: members,
      member_ids: members.map(member => member.id),
      search_text: members.map(environmentLibrarySearchText).join('\n'),
      pinned: members.some(member => member.pinned),
    });
  }
  return groups;
}

export function splitPinnedEnvironmentGroupIDs(groups: readonly EnvironmentLibraryDisplayGroup[]) {
  return {
    pinned_group_ids: groups.filter(group => group.pinned).map(group => group.id),
    regular_group_ids: groups.filter(group => !group.pinned).map(group => group.id),
  };
}
