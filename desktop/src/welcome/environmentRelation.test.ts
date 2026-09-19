import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { describe, expect, it } from 'vitest';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import { buildEnvironmentLibraryDisplayGroups, splitPinnedEnvironmentGroupIDs, environmentCloudSections } from './environmentLibraryProjection';
import { buildEnvironmentCardModel, buildProviderBackedEnvironmentActionModel, buildEnvironmentLibrarySummaryModel, environmentLibraryCount, runtimeTargetEnvironmentLibraryFilterValue, environmentProviderFilterValue, filterEnvironmentLibraryDisplayGroups, LOCAL_ENVIRONMENT_LIBRARY_FILTER, PROVIDER_ENVIRONMENT_LIBRARY_FILTER } from './viewModel';

describe('environment relationship contract', () => {
  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)('pairs %s once in either snapshot order', kind => {
    const { runtime, cloud } = linkedEnvironmentFixture(kind);
    for (const entries of [[runtime, cloud], [cloud, runtime]]) {
      const groups = buildEnvironmentLibraryDisplayGroups(entries);
      expect(groups).toHaveLength(1);
      expect(groups[0].primary_entry).toBe(runtime);
      expect(groups[0].provider_entry).toBe(cloud);
    }
  });
  it('matches search and source across either member of the relationship', () => {
    const { snapshot } = linkedEnvironmentFixture();
    expect(environmentLibraryCount(buildEnvironmentLibraryDisplayGroups(snapshot.environments))).toBe(1);
    expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), 'Cloud workspace', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toHaveLength(1);
    expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), 'Development runtime', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toHaveLength(1);
  });
  it('pins the group when either owner is pinned without changing the other owner', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    for (const entries of [[{ ...runtime, pinned: true }, cloud], [runtime, { ...cloud, pinned: true }]]) {
      expect(splitPinnedEnvironmentGroupIDs(buildEnvironmentLibraryDisplayGroups(entries))).toEqual({
        pinned_group_ids: [runtime.id], regular_group_ids: [],
      });
    }
    expect(runtime.pinned).toBe(false);
    expect(cloud.pinned).toBe(false);
  });
  it('finds either source without rewriting the relationship', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    for (const filter of [PROVIDER_ENVIRONMENT_LIBRARY_FILTER, environmentProviderFilterValue(cloud)]) {
      expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), '', filter)[0].provider_entry?.id).toBe(cloud.id);
    }
    expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), '', runtimeTargetEnvironmentLibraryFilterValue(runtime.provider_runtime_link_target!.id))[0].primary_entry.id).toBe(runtime.id);
    for (const query of [runtime.label, cloud.label, cloud.env_public_id!, cloud.remote_environment_url!]) {
      expect(environmentLibraryCount(buildEnvironmentLibraryDisplayGroups(snapshot.environments), query)).toBe(1);
    }
  });
  it('counts Cloud attention once without hiding an available Runtime', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    const entries = [runtime, { ...cloud, remote_route_state: 'provider_unreachable' as const, control_plane_sync_state: 'provider_unreachable' as const }];
    expect(buildEnvironmentLibrarySummaryModel(snapshot, buildEnvironmentLibraryDisplayGroups(entries))).toMatchObject({ environment_count: 1, attention_count: 1, ready_count: 1 });
  });
  it('keeps Cloud authorization attention visible while its existing window remains open', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    const expiredCloud = { ...cloud, window_state: 'open' as const, is_open: true,
      remote_route_state: 'auth_required' as const, control_plane_sync_state: 'auth_required' as const };
    const groups = buildEnvironmentLibraryDisplayGroups([runtime, expiredCloud]);
    expect(buildEnvironmentLibrarySummaryModel(snapshot, groups).attention_count).toBe(1);
    expect(buildEnvironmentCardModel(expiredCloud).status_label).toBe('RECONNECT REQUIRED');
    expect(buildProviderBackedEnvironmentActionModel(expiredCloud).action_presentation.primary_action.intent).toBe('focus');
  });
  it('counts both owners windows while counting the relationship once', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    const withWindows = { ...snapshot, open_windows: [runtime.id, cloud.id].map(environment_id => ({
      ...snapshot.open_windows[0], environment_id,
    })) } as typeof snapshot;
    expect(buildEnvironmentLibrarySummaryModel(withWindows, buildEnvironmentLibraryDisplayGroups(snapshot.environments))).toMatchObject({ environment_count: 1, window_count: 2 });
  });
  it.each(['connecting', 'disconnecting', 'error'] as const)('preserves the pair and original owner state during %s', state => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    const changedRuntime = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_connection_state: state } };
    const offlineCloud = { ...cloud, remote_route_state: 'offline' as const };
    const group = buildEnvironmentLibraryDisplayGroups([changedRuntime, offlineCloud])[0];
    expect(group.primary_entry).toBe(changedRuntime);
    expect(group.provider_entry).toBe(offlineCloud);
    expect(group.primary_entry.runtime_health.status).toBe('online');
  });
  it('keeps missing or unrelated owners independent', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    expect(buildEnvironmentLibraryDisplayGroups([runtime])[0].provider_entry).toBeUndefined();
    expect(buildEnvironmentLibraryDisplayGroups([cloud])[0].primary_entry).toBe(cloud);
    expect(buildEnvironmentLibraryDisplayGroups([runtime, { ...cloud, provider_linked_runtime_summary: undefined }])).toHaveLength(2);
    const unbound = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_link_state: 'unbound' as const } };
    expect(buildEnvironmentLibraryDisplayGroups([unbound, { ...cloud, provider_linked_runtime_summary: undefined }])).toHaveLength(2);
  });
  it('does not retain a stale pair after unlinking', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    const unlinked = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_link_state: 'unbound' as const } };
    expect(buildEnvironmentLibraryDisplayGroups([unlinked, cloud])).toHaveLength(2);
  });
});

describe('mixed Cloud source library built from real snapshots', () => {
  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)('preserves exact %s identity through link transitions', linkKind => {
    for (const linkState of ['linking', 'linked', 'disconnecting'] as const) {
      const { snapshot } = mixedEnvironmentFixture({ linkKind, linkState });
      const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
      const linked = groups.filter(group => group.provider_entry);
      expect(linked).toHaveLength(1);
      expect(linked[0].primary_entry.kind).toBe(linkKind);
      if (linkKind === 'wsl_environment') expect(buildEnvironmentCardModel(linked[0].primary_entry).kind_label).toBe('WSL');
      expect(linked[0].provider_entry?.env_public_id).toBe('env_0_0');
      expect(linked[0].provider_entry?.runtime_service).toBeUndefined();
    }
    const unlinked = mixedEnvironmentFixture({ linkKind, linkState: 'unbound' });
    expect(buildEnvironmentLibraryDisplayGroups(unlinked.snapshot.environments).every(group => !group.provider_entry)).toBe(true);
  });
  it('uses the same groups for source membership, same-name environments, search and linked counts', () => {
    const { snapshot } = mixedEnvironmentFixture();
    const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
    expect(groups).toHaveLength(8);
    const sections = environmentCloudSections(groups, snapshot.control_planes);
    expect(sections.map(section => [section.groups.length, section.linked_runtime_count])).toEqual([[3, 1], [3, 0]]);
    expect(sections[0].groups.find(group => group.provider_entry)).toBe(groups.find(group => group.provider_entry));
    expect(environmentCloudSections(groups, snapshot.control_planes, 'Team Cloud')[0].visible_groups).toHaveLength(3);
    expect(environmentCloudSections(groups, snapshot.control_planes, 'env_1_1')[0].visible_groups).toHaveLength(1);
    expect(environmentCloudSections(groups, snapshot.control_planes, 'Development').map(section => section.visible_groups.length)).toEqual([1, 1]);
    expect(environmentCloudSections(groups, snapshot.control_planes, 'missing')).toHaveLength(0);
  });
  it.each(['auth_required', 'provider_unreachable'] as const)('retains source members and attention during %s', syncState => {
    const { snapshot } = mixedEnvironmentFixture({ syncState });
    const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
    expect(groups).toHaveLength(8);
    expect(environmentCloudSections(groups, snapshot.control_planes).map(section => section.groups.length)).toEqual([3, 3]);
    expect(buildEnvironmentLibrarySummaryModel(snapshot, groups).attention_count).toBe(6);
  });
});
