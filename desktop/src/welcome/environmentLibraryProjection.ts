import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type EnvironmentLibraryDisplayGroup = Readonly<{
  id: string;
  primary_entry: DesktopEnvironmentEntry;
  provider_entry?: DesktopEnvironmentEntry;
  member_entries: readonly DesktopEnvironmentEntry[];
  member_ids: readonly string[];
  owner_ids?: readonly string[];
  search_text: string;
  pinned: boolean;
  cloud_source_id?: string;
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
      cloud_source_id: environmentCloudSourceID(provider ?? primary),
    });
  }
  // Cloud owners retain their established tabs. Access routes only extend the
  // original group's menu/settings; they never become additional owner tabs.
  const byID = new Map(groups.map(group => [group.id, group]));
  const merged = new Set<string>();
  for (const group of groups) {
    const ownerID = group.primary_entry.access_group_id;
    if (!ownerID || ownerID === group.id || group.primary_entry.kind !== 'gateway_environment' || !group.primary_entry.verified_runtime_identity) continue;
    const owner = byID.get(ownerID);
    if (!owner || owner.primary_entry.verified_runtime_identity !== group.primary_entry.verified_runtime_identity) continue;
    byID.set(ownerID, { ...owner, owner_ids: owner.owner_ids ?? owner.member_ids,
      member_entries: [...owner.member_entries, ...group.member_entries],
      member_ids: [...owner.member_ids, ...group.member_ids],
      search_text: `${owner.search_text}\n${group.search_text}`, pinned: owner.pinned || group.pinned });
    merged.add(group.id);
  }
  return groups.filter(group => !merged.has(group.id)).map(group => byID.get(group.id)!);
}

export function splitPinnedEnvironmentGroupIDs(groups: readonly EnvironmentLibraryDisplayGroup[]) {
  return {
    pinned_group_ids: groups.filter(group => group.pinned).map(group => group.id),
    regular_group_ids: groups.filter(group => !group.pinned).map(group => group.id),
  };
}

export function environmentCloudSourceID(entry: DesktopEnvironmentEntry): string | undefined {
  return entry.kind === 'provider_environment' && entry.provider_origin && entry.provider_id
    ? desktopControlPlaneKey(entry.provider_origin, entry.provider_id) : undefined;
}

export type EnvironmentCloudSection = Readonly<{
  id: string;
  source: DesktopControlPlaneSummary;
  groups: readonly EnvironmentLibraryDisplayGroup[];
  visible_groups: readonly EnvironmentLibraryDisplayGroup[];
  linked_runtime_count: number;
}>;

export function environmentCloudSections(
  groups: readonly EnvironmentLibraryDisplayGroup[],
  sources: readonly DesktopControlPlaneSummary[],
  query = '',
): readonly EnvironmentCloudSection[] {
  const search = query.trim().toLowerCase();
  return sources.flatMap(source => {
    const id = desktopControlPlaneKey(source.provider.provider_origin, source.provider.provider_id);
    const members = groups.filter(group => group.cloud_source_id === id);
    const sourceMatches = [source.display_label, source.provider.provider_origin, source.account.user_display_name]
      .some(value => value.toLowerCase().includes(search));
    const visible = sourceMatches ? members : members.filter(group => group.search_text.includes(search));
    return !sourceMatches && visible.length === 0 ? [] : [{
      id, source, groups: members, visible_groups: visible,
      linked_runtime_count: members.filter(group => group.provider_entry).length,
    }];
  });
}
