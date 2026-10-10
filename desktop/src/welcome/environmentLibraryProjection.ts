import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/cloud';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type EnvironmentLibraryDisplayGroup = Readonly<{
  id: string;
  primary_entry: DesktopEnvironmentEntry;
  provider_entry?: DesktopEnvironmentEntry;
  member_entries: readonly DesktopEnvironmentEntry[];
  member_ids: readonly string[];
  owner_ids?: readonly string[];
  gateway_entries?: readonly DesktopEnvironmentEntry[];
  gateway_tab_id?: string;
  search_text: string;
  pinned: boolean;
  cloud_source_id?: string;
}>;

export function environmentLibrarySearchText(entry: DesktopEnvironmentEntry): string {
  return [
    entry.label, entry.local_ui_url, ...(entry.local_ui_urls ?? []), entry.remote_environment_url,
    entry.secondary_text, entry.control_plane_label, entry.cloud_origin, entry.env_public_id,
    entry.gateway_label, entry.gateway_env_id, entry.gateway_endpoint_label, entry.gateway_member?.metadata.hostname,
    entry.ssh_details?.ssh_destination, entry.ssh_details?.runtime_root,
    entry.ssh_details?.release_base_url, entry.ssh_details?.bootstrap_strategy,
    entry.managed_runtime_host_access?.kind === 'wsl_host' ? entry.managed_runtime_host_access.distribution_name : '',
  ].filter(Boolean).join('\n').toLowerCase();
}

/** Main-process ownership is authoritative; the renderer only arranges its connections. */
export function buildEnvironmentLibraryDisplayGroups(
  entries: readonly DesktopEnvironmentEntry[],
): readonly EnvironmentLibraryDisplayGroup[] {
  const byID = new Map(entries.map(entry => [entry.id, entry]));
  const membersByOwner = new Map<string, DesktopEnvironmentEntry[]>();
  for (const entry of entries) {
    const candidate = entry.access_group_id ? byID.get(entry.access_group_id) : undefined;
    const attached = (entry.kind === 'provider_environment' || entry.kind === 'gateway_environment')
      && candidate && ['local_environment', 'ssh_environment', 'wsl_environment'].includes(candidate.kind);
    const ownerID = attached ? candidate.id : entry.id;
    membersByOwner.set(ownerID, [...(membersByOwner.get(ownerID) ?? []), entry]);
  }
  return [...membersByOwner].map(([id, members]) => {
    const primary = byID.get(id)!;
    const provider = members.find(entry => entry.kind === 'provider_environment' && entry.id !== id);
    const gateways = members.filter(entry => entry.kind === 'gateway_environment' && entry.id !== id);
    const ordered = [primary, ...(provider ? [provider] : []), ...gateways];
    const hasGateway = ['local_environment', 'ssh_environment', 'wsl_environment'].includes(primary.kind)
      && Boolean(primary.runtime_service?.gateway_memberships?.length);
    const gatewayTabID = hasGateway ? `${id}:gateway-access` : undefined;
    return {
      id, primary_entry: primary, provider_entry: provider,
      member_entries: ordered, member_ids: ordered.map(entry => entry.id),
      owner_ids: [primary.id, ...(provider ? [provider.id] : []), ...(gatewayTabID ? [gatewayTabID] : [])],
      gateway_entries: gateways.length ? gateways : undefined, gateway_tab_id: gatewayTabID,
      search_text: [ordered.map(environmentLibrarySearchText).join('\n'),
        ...(primary.runtime_service?.gateway_memberships ?? []).map(member =>
          [member.gateway_name, ...member.endpoints.map(endpoint => endpoint.address)].join('\n')),
      ].join('\n').toLowerCase(),
      pinned: ordered.some(entry => entry.pinned),
      cloud_source_id: environmentCloudSourceID(provider ?? primary),
    };
  });
}

export function splitPinnedEnvironmentGroupIDs(groups: readonly EnvironmentLibraryDisplayGroup[]) {
  return {
    pinned_group_ids: groups.filter(group => group.pinned).map(group => group.id),
    regular_group_ids: groups.filter(group => !group.pinned).map(group => group.id),
  };
}

export function environmentCloudSourceID(entry: DesktopEnvironmentEntry): string | undefined {
  return entry.kind === 'provider_environment' && entry.cloud_origin && entry.cloud_id
    ? desktopControlPlaneKey(entry.cloud_origin, entry.cloud_id) : undefined;
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
    const id = desktopControlPlaneKey(source.cloud.cloud_origin, source.cloud.cloud_id);
    const members = groups.filter(group => group.cloud_source_id === id);
    const sourceMatches = [source.display_label, source.cloud.cloud_origin, source.account.user_display_name]
      .some(value => value.toLowerCase().includes(search));
    const visible = sourceMatches ? members : members.filter(group => group.search_text.includes(search));
    return !sourceMatches && visible.length === 0 ? [] : [{
      id, source, groups: members, visible_groups: visible,
      linked_runtime_count: members.filter(group => group.provider_entry).length,
    }];
  });
}
